package com.tasf.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * CORS global y CONFIGURABLE para toda la API (incluido el SSE /events).
 *
 * Antes los orígenes estaban cableados a http://localhost:5173 en el
 * controller: cualquier despliegue con dominio/HTTPS quedaba prohibido por el
 * navegador (el error de CORS). Ahora los orígenes permitidos se leen de la
 * variable de entorno CORS_ORIGINS (lista separada por comas, admite
 * patrones), con "*" por defecto.
 *
 *   CORS_ORIGINS=https://tasf.midominio.com,https://*.midominio.com
 *
 * No usamos cookies/sesión (allowCredentials=false), así que "*" es válido y
 * no debilita nada: la API ya es pública dentro de la red donde se sirve.
 */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Value("${CORS_ORIGINS:*}")
    private String origins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(origins.split("\\s*,\\s*"))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(false)
                .maxAge(3600);   // cachea el preflight OPTIONS 1 h
    }
}
