output "host" {
  description = "Redis instance IP"
  value       = google_redis_instance.cache.host
}

output "port" {
  description = "Redis port"
  value       = google_redis_instance.cache.port
}
