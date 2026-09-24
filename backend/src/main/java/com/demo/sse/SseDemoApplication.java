package com.demo.sse;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class SseDemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(SseDemoApplication.class, args);
    }
}
