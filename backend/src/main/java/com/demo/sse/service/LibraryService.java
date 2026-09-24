package com.demo.sse.service;

import com.demo.sse.model.Document;
import com.demo.sse.model.Folder;
import com.demo.sse.model.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
public class LibraryService {

    private final SseEmitterService sseEmitterService;

    // In-memory stores
    private final Map<String, User> usersById = new ConcurrentHashMap<>();
    private final Map<String, User> usersByUsername = new ConcurrentHashMap<>();
    private final Map<String, Folder> foldersById = new ConcurrentHashMap<>();
    private final Map<String, Document> documentsById = new ConcurrentHashMap<>();

    public void addUser(User user) {
        usersById.put(user.getId(), user);
        usersByUsername.put(user.getUsername(), user);
    }

    public Optional<User> findUserById(String id) {
        return Optional.ofNullable(usersById.get(id));
    }

    public Optional<User> findUserByUsername(String username) {
        return Optional.ofNullable(usersByUsername.get(username));
    }

    public List<User> getAllUsers() {
        return new ArrayList<>(usersById.values());
    }

    // Folders
    public Folder createFolder(String name, String ownerId) {
        Folder folder = new Folder();
        folder.setId(UUID.randomUUID().toString());
        folder.setName(name);
        folder.setOwnerId(ownerId);
        foldersById.put(folder.getId(), folder);
        log.debug("Folder created: {} by userId={}", name, ownerId);
        return folder;
    }

    public List<Folder> getFoldersForUser(String userId) {
        return foldersById.values().stream()
                .filter(f -> f.getOwnerId().equals(userId) || f.getSharedWithUserIds().contains(userId))
                .sorted(Comparator.comparing(Folder::getName))
                .collect(Collectors.toList());
    }

    public Optional<Folder> findFolderById(String folderId) {
        return Optional.ofNullable(foldersById.get(folderId));
    }

    public Folder shareFolder(String folderId, String ownerUserId, String targetUserId) {
        Folder folder = foldersById.get(folderId);
        if (folder == null) throw new NoSuchElementException("Folder not found: " + folderId);
        if (!folder.getOwnerId().equals(ownerUserId)) throw new SecurityException("Not folder owner");

        folder.getSharedWithUserIds().add(targetUserId);

        User sharedBy = usersById.get(ownerUserId);
        User targetUser = usersById.get(targetUserId);

        // Notify target user
        Map<String, Object> notificationPayload = Map.of(
                "type", "FOLDER_SHARED",
                "folderId", folder.getId(),
                "folderName", folder.getName(),
                "sharedByUserId", ownerUserId,
                "sharedByUsername", sharedBy != null ? sharedBy.getDisplayName() : ownerUserId,
                "timestamp", Instant.now().toString()
        );
        sseEmitterService.publish(targetUserId, "user:" + targetUserId + ":notifications", notificationPayload);

        log.debug("Folder {} shared with userId={}", folderId, targetUserId);
        return folder;
    }

    // Documents
    public Document createDocument(String name, String folderId, String creatorUserId) {
        Folder folder = foldersById.get(folderId);
        if (folder == null) throw new NoSuchElementException("Folder not found: " + folderId);
        if (!folder.getAllMemberIds().contains(creatorUserId)) {
            throw new SecurityException("User is not a member of this folder");
        }

        Document doc = new Document();
        doc.setId(UUID.randomUUID().toString());
        doc.setName(name);
        doc.setFolderId(folderId);
        doc.setCreatedByUserId(creatorUserId);
        doc.setCreatedAt(Instant.now());
        documentsById.put(doc.getId(), doc);

        User creator = usersById.get(creatorUserId);

        // Notify all folder members EXCEPT the creator
        Map<String, Object> eventPayload = Map.of(
                "type", "DOCUMENT_CREATED",
                "documentId", doc.getId(),
                "documentName", doc.getName(),
                "folderId", folder.getId(),
                "folderName", folder.getName(),
                "createdByUserId", creatorUserId,
                "createdByUsername", creator != null ? creator.getDisplayName() : creatorUserId,
                "timestamp", doc.getCreatedAt().toString()
        );

        String topic = "folder:" + folderId;
        Set<String> recipients = new HashSet<>(folder.getAllMemberIds());
        recipients.remove(creatorUserId); // Don't notify the creator

        sseEmitterService.publishToUsers(recipients, topic, eventPayload);

        // Also publish to per-user notification stream
        for (String recipientId : recipients) {
            Map<String, Object> notifPayload = new HashMap<>(eventPayload);
            notifPayload.put("type", "DOCUMENT_CREATED_NOTIFICATION");
            sseEmitterService.publish(recipientId, "user:" + recipientId + ":notifications", notifPayload);
        }

        log.debug("Document '{}' created in folder {} by userId={}", name, folderId, creatorUserId);
        return doc;
    }

    public List<Document> getDocumentsInFolder(String folderId, String userId) {
        Folder folder = foldersById.get(folderId);
        if (folder == null) throw new NoSuchElementException("Folder not found: " + folderId);
        if (!folder.getAllMemberIds().contains(userId)) throw new SecurityException("Access denied");

        return documentsById.values().stream()
                .filter(d -> d.getFolderId().equals(folderId))
                .sorted(Comparator.comparing(Document::getCreatedAt).reversed())
                .collect(Collectors.toList());
    }

    public void deleteDocument(String documentId, String userId) {
        Document doc = documentsById.get(documentId);
        if (doc == null) throw new NoSuchElementException("Document not found: " + documentId);

        Folder folder = foldersById.get(doc.getFolderId());
        if (folder == null) throw new NoSuchElementException("Folder not found");
        if (!folder.getAllMemberIds().contains(userId)) throw new SecurityException("Access denied");

        documentsById.remove(documentId);

        User deleter = usersById.get(userId);
        Map<String, Object> eventPayload = Map.of(
                "type", "DOCUMENT_DELETED",
                "documentId", doc.getId(),
                "documentName", doc.getName(),
                "folderId", folder.getId(),
                "folderName", folder.getName(),
                "deletedByUsername", deleter != null ? deleter.getDisplayName() : userId,
                "timestamp", Instant.now().toString()
        );

        String topic = "folder:" + doc.getFolderId();
        Set<String> recipients = new HashSet<>(folder.getAllMemberIds());
        recipients.remove(userId);
        sseEmitterService.publishToUsers(recipients, topic, eventPayload);
    }
}
