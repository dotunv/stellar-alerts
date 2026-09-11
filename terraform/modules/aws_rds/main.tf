resource "aws_db_subnet_group" "rds" {
  name        = "${var.environment}-stellar-alerts-db-subnet-group"
  subnet_ids  = var.private_subnet_ids
  description = "Subnet group for Stellar Alerts RDS PostgreSQL"

  tags = {
    Name        = "${var.environment}-rds-subnet-group"
    Environment = var.environment
  }
}

resource "aws_security_group" "rds" {
  name        = "${var.environment}-stellar-alerts-rds-sg"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = var.vpc_id

  ingress {
    description = "PostgreSQL access from VPC"
    from_port   = 5432
    to_port     = 5432
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
    Name        = "${var.environment}-rds-sg"
    Environment = var.environment
  }
}

resource "aws_db_instance" "postgres" {
  identifier             = "${var.environment}-stellar-alerts-postgres"
  allocated_storage      = var.allocated_storage
  max_allocated_storage  = var.max_allocated_storage
  engine                 = "postgres"
  engine_version         = "16.1"
  instance_class         = var.instance_class
  db_name                = var.db_name
  username               = var.db_username
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.rds.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  skip_final_snapshot    = var.environment != "prod"
  publicly_accessible    = false
  deletion_protection    = var.environment == "prod"
  storage_encrypted      = true

  tags = {
    Name        = "${var.environment}-stellar-alerts-rds"
    Environment = var.environment
  }
}
