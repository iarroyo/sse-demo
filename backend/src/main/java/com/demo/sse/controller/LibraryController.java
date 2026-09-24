package com.demo.sse.controller;

import com.demo.sse.model.Document;
import com.demo.sse.model.Folder;
import com.demo.sse.model.User;
import com.demo.sse.service.LibraryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

@RestController
@RequestMapping("/api/library")
@RequiredArgsConstructor
public class LibraryController {

    private final LibraryService libraryService;

    private User currentUser(Authentication auth) {
        return libraryService.findUserByUsername(auth.getName())
                .orElseThrow(() -> new RuntimeException("User not found"));
    }

    // ---- Users ----
    @GetMapping("/users")
    public ResponseEntity<List<User>> listUsers(Authentication auth) {
        // Return all users except current user (for share dialog)
        String currentUserId = currentUser(auth).getId();
        List<User> others = libraryService.getAllUsers().stream()
                .filter(u -> !u.getId().equals(currentUserId))
                .map(u -> new User(u.getId(), u.getUsername(), null, u.getDisplayName()))
                .toList();
        return ResponseEntity.ok(others);
    }

    // ---- Folders ----
    @GetMapping("/folders")
    public ResponseEntity<List<Folder>> listFolders(Authentication auth) {
        User user = currentUser(auth);
        return ResponseEntity.ok(libraryService.getFoldersForUser(user.getId()));
    }

    @PostMapping("/folders")
    public ResponseEntity<?> createFolder(@RequestBody Map<String, String> body, Authentication auth) {
        String name = body.get("name");
        if (name == null || name.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "name is required"));
        }
        User user = currentUser(auth);
        Folder folder = libraryService.createFolder(name.trim(), user.getId());
        return ResponseEntity.ok(folder);
    }

    @PostMapping("/folders/{folderId}/share")
    public ResponseEntity<?> shareFolder(
            @PathVariable String folderId,
            @RequestBody Map<String, String> body,
            Authentication auth) {
        String targetUserId = body.get("userId");
        if (targetUserId == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "userId is required"));
        }
        try {
            User user = currentUser(auth);
            Folder folder = libraryService.shareFolder(folderId, user.getId(), targetUserId);
            return ResponseEntity.ok(folder);
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
        }
    }

    // ---- Documents ----
    @GetMapping("/folders/{folderId}/documents")
    public ResponseEntity<?> listDocuments(@PathVariable String folderId, Authentication auth) {
        try {
            User user = currentUser(auth);
            List<Document> docs = libraryService.getDocumentsInFolder(folderId, user.getId());
            return ResponseEntity.ok(docs);
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/folders/{folderId}/documents")
    public ResponseEntity<?> createDocument(
            @PathVariable String folderId,
            @RequestBody Map<String, String> body,
            Authentication auth) {
        String name = body.get("name");
        if (name == null || name.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "name is required"));
        }
        try {
            User user = currentUser(auth);
            Document doc = libraryService.createDocument(name.trim(), folderId, user.getId());
            return ResponseEntity.ok(doc);
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/documents/{documentId}")
    public ResponseEntity<?> deleteDocument(@PathVariable String documentId, Authentication auth) {
        try {
            User user = currentUser(auth);
            libraryService.deleteDocument(documentId, user.getId());
            return ResponseEntity.noContent().build();
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
        }
    }
}
