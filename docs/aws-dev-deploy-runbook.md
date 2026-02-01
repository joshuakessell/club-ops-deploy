# AWS Dev Deploy Runbook (Option B)

This runbook covers the **dev-only** AWS deployment for:
- API: App Runner
- Frontends: S3 + CloudFront
- CI/CD: GitHub Actions with OIDC

All resources are prefixed with `club-ops-dev-` and tagged with:
`Project=ClubOperationsPOS`, `Owner=JoshuaKessell`, `Environment=dev`.

## One-time Setup

### 1) Terraform apply (local state)
From repo root:

```bash
cd infra/terraform
terraform init
terraform plan -out tfplan
terraform apply tfplan
```

Note: Terraform state is **local** for now. Do **not** commit `terraform.tfstate`. Plan a remote backend later.

### 2) Cloudflare DNS (DNS-only, proxy OFF)
Terraform outputs the DNS validation records for ACM and App Runner.

Add these CNAME records in Cloudflare (DNS only, no proxy):
- ACM validation records from `acm_frontend_validation_records`
- App Runner validation records from `apprunner_custom_domain_validation_records`

After DNS is set, re-run:

```bash
cd infra/terraform
terraform apply
```

### 3) GitHub Actions secrets
Add these in GitHub repo settings → Secrets:

**AWS / IAM**
- `AWS_ROLE_ARN` = Terraform output `github_actions_role_arn`

**App Runner / API**
- `APP_RUNNER_SERVICE_ARN` = Terraform output `apprunner_service_arn`
- `ECR_REPO_URI` = `146469921099.dkr.ecr.us-east-1.amazonaws.com/club-ops-api`
- `KIOSK_TOKEN` = required by API
- `DATABASE_URL` = production database URL for dev demo
  - Alternatively, use discrete DB vars and update the API deploy script, but DATABASE_URL is simplest.

**Frontends**
- `VITE_KIOSK_TOKEN` = required by both frontends
- `EMPLOYEE_BUCKET` = Terraform output `employee_bucket_name`
- `EMPLOYEE_DISTRIBUTION_ID` = Terraform output `employee_cloudfront_distribution_id`
- `CUSTOMER_BUCKET` = Terraform output `customer_bucket_name`
- `CUSTOMER_DISTRIBUTION_ID` = Terraform output `customer_cloudfront_distribution_id`

## Day-to-Day Workflow

1) Create a feature branch and open PR to `main`.
2) CI runs automatically (lint + build + typecheck).
3) Merge to `main` triggers **deploy**:
   - API image build + push → App Runner update
   - Frontend build → S3 sync → CloudFront invalidation

## Where Variables Live

- **GitHub Secrets**: deploy-time values (KIOSK_TOKEN, DATABASE_URL, VITE_KIOSK_TOKEN)
- **App Runner runtime env**: set on deploy via `deploy-api.sh`
- **Vite build-time env**: passed in deploy scripts/workflow

## Verification

API:
```bash
curl https://api-demo.joshuakessell.com/health
```
Expected: JSON with `status: ok` and current timestamp.

Employee register:
```bash
curl -I https://employee-demo.joshuakessell.com
```
Expected: HTTP 200 from CloudFront.

Customer kiosk:
```bash
curl -I https://customer-demo.joshuakessell.com
```
Expected: HTTP 200 from CloudFront.

## Rollback

**API**
- Re-deploy a previous ECR tag:
  - Update the image tag in the deploy script or run:
    ```bash
    ECR_REPO_URI=146469921099.dkr.ecr.us-east-1.amazonaws.com/club-ops-api \
    APP_RUNNER_SERVICE_ARN=... \
    KIOSK_TOKEN=... DATABASE_URL=... \
    IMAGE_TAG=<previous-tag> \
    scripts/aws/deploy-api.sh
    ```

**Frontends**
- Rebuild from a previous commit and redeploy:
  ```bash
  git checkout <commit>
  scripts/aws/deploy-employee-register.sh
  scripts/aws/deploy-customer-kiosk.sh
  ```

## Troubleshooting

- **App Runner logs**: AWS Console → App Runner → Service → Logs
- **CloudFront 403/404**: confirm OAC and bucket policy; ensure index.html exists
- **S3 sync errors**: verify bucket name + AWS permissions
- **OIDC assume role**: confirm GitHub repo in Terraform (`github_repo`) matches, role ARN secret set

## Branch Protection Guidance

Enable branch protection on `main` in GitHub:
- Require status checks: CI + Lint
- Require PR reviews
- Require signed commits (optional)

(Do not enforce via automation.)
