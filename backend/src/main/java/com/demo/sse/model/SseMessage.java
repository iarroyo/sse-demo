package com.demo.sse.model;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class SseMessage {
    private String eventName;
    private String resourceId;
    private Object payload;

    public SseMessage(Topic topic, Object payload) {
        this(topic.eventName(), topic.resourceId(), payload);
    }
}
