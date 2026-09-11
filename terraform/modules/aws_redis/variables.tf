variable "environment" {
  description = "Target deployment environment"
  type        = string
  default     = "dev"
}

variable "vpc_id" {
  description = "VPC ID where Redis is deployed"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR for Redis security group ingress"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for Redis subnet group"
  type        = list(string)
}

variable "node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro"
}
