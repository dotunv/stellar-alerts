resource "aws_elasticache_subnet_group" "redis" {
  name        = "${var.environment}-stellar-alerts-redis-subnet-group"
  subnet_ids  = var.private_subnet_ids
  description = "Subnet group for Stellar Alerts ElastiCache Redis"
}

resource "aws_security_group" "redis" {
  name        = "${var.environment}-stellar-alerts-redis-sg"
  description = "Security group for Redis cluster"
  vpc_id      = var.vpc_id

  ingress {
    description = "Redis access from VPC"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.environment}-redis-sg"
    Environment = var.environment
  }
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${var.environment}-stellar-alerts-redis"
  engine               = "redis"
  node_type            = var.node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.redis.id]

  tags = {
    Name        = "${var.environment}-stellar-alerts-redis"
    Environment = var.environment
  }
}
