package com.demo.sse.controller;

import com.demo.sse.model.Topic;
import com.demo.sse.service.SseEmitterService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/sse")
@RequiredArgsConstructor
public class SseSubscriptionController {

    private final SseEmitterService sseEmitterService;

    @PostMapping("/subscriptions")
    public ResponseEntity<?> subscribe(
            @RequestHeader("X-Emitter-Id") String emitterId,
            @RequestBody Topic topic,
            Authentication authentication) {
        if (topic.eventName() == null || topic.eventName().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "eventName is required"));
        }
        sseEmitterService.addSubscription(emitterId, topic);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/subscriptions")
    public ResponseEntity<?> unsubscribe(
            @RequestHeader("X-Emitter-Id") String emitterId,
            @RequestBody Topic topic,
            Authentication authentication) {
        if (topic.eventName() == null || topic.eventName().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "eventName is required"));
        }
        sseEmitterService.removeSubscription(emitterId, topic);
        return ResponseEntity.noContent().build();
    }
}
