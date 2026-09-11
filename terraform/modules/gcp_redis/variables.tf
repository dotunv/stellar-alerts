variable "environment" {
  description = "Target deployment environment"
  type        = string
  default     = "dev"
}

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "network_id" {
  description = "VPC network ID"
  type        = string
}

variable "memory_size_gb" {
  description = "Redis memory size in GB"
  type        = number
  default     = 1
}
