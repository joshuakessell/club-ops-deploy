variable "aws_region" {
  type        = string
  description = "AWS region for all dev resources"
  default     = "us-east-1"
}

variable "github_repo" {
  type        = string
  description = "GitHub repo in owner/name format for OIDC trust"
  default     = "joshuakessell/ClubOperationsPOS"
}

variable "github_oidc_thumbprint" {
  type        = string
  description = "GitHub Actions OIDC root CA thumbprint"
  default     = "6938fd4d98bab03faadb97b34396831e3780aea1"
}

variable "ecr_repo_url" {
  type        = string
  description = "ECR repo URL for the API image"
  default     = "146469921099.dkr.ecr.us-east-1.amazonaws.com/club-ops-api"
}

variable "api_domain" {
  type        = string
  description = "Custom domain for App Runner API"
  default     = "api-demo.joshuakessell.com"
}

variable "employee_domain" {
  type        = string
  description = "Custom domain for employee register frontend"
  default     = "employee-demo.joshuakessell.com"
}

variable "customer_domain" {
  type        = string
  description = "Custom domain for customer kiosk frontend"
  default     = "customer-demo.joshuakessell.com"
}

variable "employee_bucket_name" {
  type        = string
  description = "S3 bucket name for employee register"
  default     = "club-ops-dev-employee-demo"
}

variable "customer_bucket_name" {
  type        = string
  description = "S3 bucket name for customer kiosk"
  default     = "club-ops-dev-customer-demo"
}
