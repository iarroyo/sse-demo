package com.demo.sse.config;

import com.demo.sse.model.User;
import com.demo.sse.service.LibraryService;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class DataInitializer implements CommandLineRunner {

    private final LibraryService libraryService;

    @Override
    public void run(String... args) {
        // Seed demo users
        libraryService.addUser(new User("user-alice", "alice", "alice", "Alice"));
        libraryService.addUser(new User("user-bob", "bob", "bob", "Bob"));
        libraryService.addUser(new User("user-charlie", "charlie", "charlie", "Charlie"));
    }
}
