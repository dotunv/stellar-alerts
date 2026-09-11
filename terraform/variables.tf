variable "target_cloud" {
  description = "Target cloud provider to provision (aws or gcp)"
  type        = string
  default     = "aws"
  validation {
    condition     = contains(["aws", "gcp"], var.target_cloud)
    error_message = "target_cloud must be either 'aws' or 'gcp'."
  }
}

variable "environment" {
  description = "Target deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

# --- Database & Redis Shared Variables ---
variable "db_name" {
  description = "Database name for PostgreSQL"
  type        = string
  default     = "stellar_alerts"
}

variable "db_username" {
  description = "Database administrator username"
  type        = string
  default     = "alerts_admin"
}

variable "db_password" {
  description = "Database administrator password"
  type        = string
  sensitive   = true
  default     = "SuperSecretAlertsPassword123!"
}

variable "k8s_node_count" {
  description = "Kubernetes worker node count"
  type        = number
  default     = 2
}

# --- AWS Specific Variables ---
variable "aws_region" {
  description = "AWS deployment region"
  type        = string
  default     = "us-east-1"
}

variable "aws_vpc_cidr" {
  description = "CIDR block for AWS VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "aws_public_subnet_cidrs" {
  description = "AWS public subnet CIDRs"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "aws_private_subnet_cidrs" {
  description = "AWS private subnet CIDRs"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.20.0/24"]
}

variable "aws_availability_zones" {
  description = "AWS Availability Zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# --- GCP Specific Variables ---
variable "gcp_project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "stellar-alerts-dev"
}

variable "gcp_region" {
  description = "GCP deployment region"
  type        = string
  default     = "us-central1"
}
