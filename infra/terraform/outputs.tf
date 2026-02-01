output "github_actions_role_arn" {
  value       = aws_iam_role.github_actions.arn
  description = "ARN of the GitHub Actions OIDC role"
}

output "apprunner_service_arn" {
  value       = aws_apprunner_service.api.arn
  description = "App Runner service ARN for the API"
}

output "apprunner_service_url" {
  value       = aws_apprunner_service.api.service_url
  description = "Default App Runner service URL"
}

output "apprunner_custom_domain_validation_records" {
  value       = aws_apprunner_custom_domain_association.api.certificate_validation_records
  description = "CNAME records required to validate the App Runner custom domain"
}

output "employee_bucket_name" {
  value       = aws_s3_bucket.employee.bucket
  description = "S3 bucket for employee register"
}

output "customer_bucket_name" {
  value       = aws_s3_bucket.customer.bucket
  description = "S3 bucket for customer kiosk"
}

output "employee_cloudfront_domain" {
  value       = aws_cloudfront_distribution.employee.domain_name
  description = "CloudFront domain for employee register"
}

output "customer_cloudfront_domain" {
  value       = aws_cloudfront_distribution.customer.domain_name
  description = "CloudFront domain for customer kiosk"
}

output "employee_cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.employee.id
  description = "CloudFront distribution ID for employee register"
}

output "customer_cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.customer.id
  description = "CloudFront distribution ID for customer kiosk"
}

output "acm_frontend_validation_records" {
  value       = aws_acm_certificate.frontend.domain_validation_options
  description = "DNS records to add in Cloudflare to validate the frontend certificate"
}
