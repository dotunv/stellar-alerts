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

variable "network_name" {
  description = "VPC network name"
  type        = string
}

variable "subnet_name" {
  description = "Subnet name"
  type        = string
}

variable "node_count" {
  description = "Number of GKE worker nodes"
  type        = number
  default     = 2
}

variable "machine_type" {
  description = "GCE Machine Type"
  type        = string
  default     = "e2-medium"
}
