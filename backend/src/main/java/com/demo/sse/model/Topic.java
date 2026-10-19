package com.demo.sse.model;

/**
 * SSE subscription topic. The recipient user is resolved from the session,
 * so topics never carry a userId.
 *
 * @param eventName  kind of event stream, e.g. "folder" or "notifications"
 * @param resourceId identifier of the resource the stream is about, or null
 */
public record Topic(String eventName, String resourceId) {

    public static final Topic NOTIFICATIONS = new Topic("notifications", null);

    public Topic {
        // Normalise so {resourceId: ""} and a missing resourceId are the same topic
        if (resourceId != null && resourceId.isBlank()) {
            resourceId = null;
        }
    }

    public static Topic folder(String folderId) {
        return new Topic("folder", folderId);
    }
}
