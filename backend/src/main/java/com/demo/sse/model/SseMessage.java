package com.demo.sse.model;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class SseMessage {
    private String topic;
    private Object payload;
}
