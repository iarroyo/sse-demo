package com.demo.sse.controller;

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
            @RequestBody Map<String, String> body,
            Authentication authentication) {
        String topic = body.get("topic");
        if (topic == null || topic.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "topic is required"));
        }
        sseEmitterService.addSubscription(emitterId, topic);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/subscriptions")
    public ResponseEntity<?> unsubscribe(
            @RequestHeader("X-Emitter-Id") String emitterId,
            @RequestBody Map<String, String> body,
            Authentication authentication) {
        String topic = body.get("topic");
        if (topic == null || topic.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "topic is required"));
        }
        sseEmitterService.removeSubscription(emitterId, topic);
        return ResponseEntity.noContent().build();
    }
}
