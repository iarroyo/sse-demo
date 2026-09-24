package com.demo.sse.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class Document {
    private String id;
    private String name;
    private String folderId;
    private String createdByUserId;
    private Instant createdAt;
}
