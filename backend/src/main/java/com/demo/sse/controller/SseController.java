package com.demo.sse.controller;

import com.demo.sse.model.User;
import com.demo.sse.service.LibraryService;
import com.demo.sse.service.SseEmitterService;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/sse")
@Slf4j
@RequiredArgsConstructor
public class SseController {

    private final SseEmitterService sseEmitterService;
    private final LibraryService libraryService;

    @GetMapping(value = "/connect", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter connect(Authentication authentication, HttpServletResponse response) {
        if (authentication == null || !authentication.isAuthenticated()) {
            response.setStatus(401);
            return null;
        }

        String username = authentication.getName();
        User user = libraryService.findUserByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));

        // Prevent proxy buffering of SSE
        response.setHeader("X-Accel-Buffering", "no");
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection", "keep-alive");

        log.info("SSE connection established for user={} ({})", user.getDisplayName(), user.getId());
        return sseEmitterService.createEmitter(user.getId());
    }
}
