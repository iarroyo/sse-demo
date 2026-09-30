package com.demo.sse.service;

import com.demo.sse.model.SseMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Service
@Slf4j
@RequiredArgsConstructor
public class SseEmitterService {

    private final ObjectMapper objectMapper;

    // userId -> list of active emitters (multiple devices/browsers per user)
    private final Map<String, CopyOnWriteArrayList<SseEmitter>> emitters = new ConcurrentHashMap<>();

    // emitterId -> emitter (for subscription lookup during publish)
    private final Map<String, SseEmitter> emittersById = new ConcurrentHashMap<>();

    // emitter -> emitterId (reverse lookup for cleanup)
    private final Map<SseEmitter, String> emitterIdByEmitter = new ConcurrentHashMap<>();

    // emitterId -> subscribed topics
    private final Map<String, Set<String>> emitterTopics = new ConcurrentHashMap<>();

    public SseEmitter createEmitter(String userId) {
        String emitterId = UUID.randomUUID().toString();
        SseEmitter emitter = new SseEmitter(Long.MAX_VALUE);

        emitters.computeIfAbsent(userId, k -> new CopyOnWriteArrayList<>()).add(emitter);
        emittersById.put(emitterId, emitter);
        emitterIdByEmitter.put(emitter, emitterId);
        emitterTopics.put(emitterId, ConcurrentHashMap.newKeySet());

        Runnable cleanup = () -> {
            removeEmitter(userId, emitter);
            cleanupEmitter(emitterId);
        };
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(e -> cleanup.run());

        // Send emitterId as the first event so the client can identify this connection
        try {
            emitter.send(SseEmitter.event()
                    .name("message")
                    .data(objectMapper.writeValueAsString(
                            Map.of("type", "emitter:id", "emitterId", emitterId))));
        } catch (IOException e) {
            log.warn("Failed to send emitter:id for emitterId={}", emitterId);
        }

        log.debug("SSE emitter created for user={}, emitterId={}", userId, emitterId);
        return emitter;
    }

    public void addSubscription(String emitterId, String topic) {
        Set<String> topics = emitterTopics.get(emitterId);
        if (topics == null) {
            log.warn("addSubscription: unknown emitterId={}", emitterId);
            return;
        }
        topics.add(topic);
        log.debug("Subscription added: emitterId={}, topic={}", emitterId, topic);
    }

    public void removeSubscription(String emitterId, String topic) {
        Set<String> topics = emitterTopics.get(emitterId);
        if (topics == null) {
            log.warn("removeSubscription: unknown emitterId={}", emitterId);
            return;
        }
        topics.remove(topic);
        log.debug("Subscription removed: emitterId={}, topic={}", emitterId, topic);
    }

    public void publish(String userId, String topic, Object payload) {
        List<SseEmitter> userEmitters = emitters.getOrDefault(userId, new CopyOnWriteArrayList<>());
        if (userEmitters.isEmpty()) return;

        SseMessage message = new SseMessage(topic, payload);
        List<SseEmitter> dead = new ArrayList<>();

        for (SseEmitter emitter : userEmitters) {
            String emitterId = emitterIdByEmitter.get(emitter);
            Set<String> subscribedTopics = emitterId != null
                    ? emitterTopics.getOrDefault(emitterId, Set.of())
                    : Set.of();

            if (!subscribedTopics.contains(topic)) {
                log.debug("Skipping publish: emitterId={} not subscribed to topic={}", emitterId, topic);
                continue;
            }

            try {
                emitter.send(SseEmitter.event()
                        .name("message")
                        .data(objectMapper.writeValueAsString(message)));
            } catch (IOException e) {
                log.debug("Dead emitter for user={}, removing", userId);
                dead.add(emitter);
            }
        }
        dead.forEach(e -> removeEmitter(userId, e));
    }

    public void publishToUsers(Iterable<String> userIds, String topic, Object payload) {
        for (String userId : userIds) {
            publish(userId, topic, payload);
        }
    }

    private void removeEmitter(String userId, SseEmitter emitter) {
        List<SseEmitter> list = emitters.get(userId);
        if (list != null) {
            list.remove(emitter);
            if (list.isEmpty()) {
                emitters.remove(userId);
                log.debug("All emitters removed for user={}", userId);
            }
        }
    }

    private void cleanupEmitter(String emitterId) {
        SseEmitter emitter = emittersById.remove(emitterId);
        if (emitter != null) {
            emitterIdByEmitter.remove(emitter);
        }
        emitterTopics.remove(emitterId);
        log.debug("Emitter cleaned up: emitterId={}", emitterId);
    }

    @Scheduled(fixedDelay = 25_000)
    public void sendHeartbeat() {
        emitters.forEach((userId, list) -> {
            List<SseEmitter> dead = new ArrayList<>();
            for (SseEmitter emitter : list) {
                try {
                    emitter.send(SseEmitter.event().comment("heartbeat"));
                } catch (IOException e) {
                    dead.add(emitter);
                }
            }
            dead.forEach(e -> removeEmitter(userId, e));
        });
    }

    public int getConnectedUserCount() {
        return emitters.size();
    }
}
