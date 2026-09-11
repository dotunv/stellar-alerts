variable "environment" {
  description = "Target deployment environment"
  type        = string
  default     = "dev"
}

variable "vpc_id" {
  description = "VPC ID where RDS will be deployed"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR for ingress rules"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for DB subnet group"
  type        = list(string)
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Allocated storage in GB"
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Max auto-scaling storage in GB"
  type        = number
  default     = 100
}

variable "db_name" {
  description = "Postgres database name"
  type        = string
  default     = "stellar_alerts"
}

variable "db_username" {
  description = "Postgres root username"
  type        = string
  default     = "alerts_admin"
}

variable "db_password" {
  description = "Postgres master password"
  type        = string
  sensitive   = true
}
