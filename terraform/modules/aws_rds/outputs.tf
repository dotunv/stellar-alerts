output "endpoint" {
  description = "Connection endpoint for PostgreSQL database"
  value       = aws_db_instance.postgres.endpoint
}

output "db_name" {
  description = "Database name"
  value       = aws_db_instance.postgres.db_name
}

output "port" {
  description = "Database port"
  value       = aws_db_instance.postgres.port
}

output "security_group_id" {
  description = "Security group ID for RDS"
  value       = aws_security_group.rds.id
}
