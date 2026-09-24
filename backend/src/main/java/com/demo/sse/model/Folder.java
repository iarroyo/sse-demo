package com.demo.sse.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.HashSet;
import java.util.Set;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class Folder {
    private String id;
    private String name;
    private String ownerId;
    private Set<String> sharedWithUserIds = new HashSet<>();

    public Set<String> getAllMemberIds() {
        Set<String> all = new HashSet<>(sharedWithUserIds);
        all.add(ownerId);
        return all;
    }
}
