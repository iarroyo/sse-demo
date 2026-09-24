package com.demo.sse.service;

import com.demo.sse.model.SseMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Service
@Slf4j
@RequiredArgsConstructor
public class SseEmitterService {

    private final ObjectMapper objectMapper;

    // userId -> list of active emitters (multiple devices/tabs per user)
    private final Map<String, CopyOnWriteArrayList<SseEmitter>> emitters = new ConcurrentHashMap<>();

    public SseEmitter createEmitter(String userId) {
        // Long timeout — client reconnects automatically via EventSource
        SseEmitter emitter = new SseEmitter(Long.MAX_VALUE);
        emitters.computeIfAbsent(userId, k -> new CopyOnWriteArrayList<>()).add(emitter);

        Runnable cleanup = () -> removeEmitter(userId, emitter);
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(e -> cleanup.run());

        log.debug("SSE emitter created for user={}", userId);
        return emitter;
    }

    public void publish(String userId, String topic, Object payload) {
        List<SseEmitter> userEmitters = emitters.getOrDefault(userId, new CopyOnWriteArrayList<>());
        if (userEmitters.isEmpty()) return;

        SseMessage message = new SseMessage(topic, payload);
        List<SseEmitter> dead = new ArrayList<>();

        for (SseEmitter emitter : userEmitters) {
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
