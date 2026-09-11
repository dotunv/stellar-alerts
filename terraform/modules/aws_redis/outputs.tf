output "cache_nodes" {
  description = "Redis cache nodes"
  value       = aws_elasticache_cluster.redis.cache_nodes
}

output "port" {
  description = "Redis port"
  value       = aws_elasticache_cluster.redis.port
}

output "security_group_id" {
  description = "Security group ID for Redis"
  value       = aws_security_group.redis.id
}
