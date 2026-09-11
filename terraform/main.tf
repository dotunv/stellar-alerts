terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.30"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 5.10"
    }
  }
}

# ==============================================================================
# AWS Multi-Cloud Infrastructure (when target_cloud = "aws")
# ==============================================================================

provider "aws" {
  region = var.aws_region
}

module "aws_vpc" {
  count  = var.target_cloud == "aws" ? 1 : 0
  source = "./modules/aws_vpc"

  environment          = var.environment
  vpc_cidr             = var.aws_vpc_cidr
  public_subnet_cidrs  = var.aws_public_subnet_cidrs
  private_subnet_cidrs = var.aws_private_subnet_cidrs
  availability_zones   = var.aws_availability_zones
}

module "aws_rds" {
  count  = var.target_cloud == "aws" ? 1 : 0
  source = "./modules/aws_rds"

  environment        = var.environment
  vpc_id             = module.aws_vpc[0].vpc_id
  vpc_cidr           = module.aws_vpc[0].vpc_cidr
  private_subnet_ids = module.aws_vpc[0].private_subnet_ids
  db_name            = var.db_name
  db_username        = var.db_username
  db_password        = var.db_password
}

module "aws_redis" {
  count  = var.target_cloud == "aws" ? 1 : 0
  source = "./modules/aws_redis"

  environment        = var.environment
  vpc_id             = module.aws_vpc[0].vpc_id
  vpc_cidr           = module.aws_vpc[0].vpc_cidr
  private_subnet_ids = module.aws_vpc[0].private_subnet_ids
}

module "aws_eks" {
  count  = var.target_cloud == "aws" ? 1 : 0
  source = "./modules/aws_eks"

  environment        = var.environment
  public_subnet_ids  = module.aws_vpc[0].public_subnet_ids
  private_subnet_ids = module.aws_vpc[0].private_subnet_ids
  desired_node_count = var.k8s_node_count
}

# ==============================================================================
# GCP Multi-Cloud Infrastructure (when target_cloud = "gcp")
# ==============================================================================

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

module "gcp_vpc" {
  count  = var.target_cloud == "gcp" ? 1 : 0
  source = "./modules/gcp_vpc"

  environment = var.environment
  project_id  = var.gcp_project_id
  region      = var.gcp_region
}

module "gcp_sql" {
  count  = var.target_cloud == "gcp" ? 1 : 0
  source = "./modules/gcp_sql"

  environment = var.environment
  project_id  = var.gcp_project_id
  region      = var.gcp_region
  network_id  = module.gcp_vpc[0].network_id
  db_name     = var.db_name
  db_username = var.db_username
  db_password = var.db_password
}

module "gcp_redis" {
  count  = var.target_cloud == "gcp" ? 1 : 0
  source = "./modules/gcp_redis"

  environment = var.environment
  project_id  = var.gcp_project_id
  region      = var.gcp_region
  network_id  = module.gcp_vpc[0].network_id
}

module "gcp_gke" {
  count  = var.target_cloud == "gcp" ? 1 : 0
  source = "./modules/gcp_gke"

  environment  = var.environment
  project_id   = var.gcp_project_id
  region       = var.gcp_region
  network_name = module.gcp_vpc[0].network_name
  subnet_name  = module.gcp_vpc[0].subnet_name
  node_count   = var.k8s_node_count
}
