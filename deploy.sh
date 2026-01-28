#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-club-ops-demo}"
ECR_REPO_NAME="${ECR_REPO_NAME:-club-ops-api}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

: "${KIOSK_TOKEN:?Set KIOSK_TOKEN in your shell}"
: "${DB_PASSWORD:?Set DB_PASSWORD in your shell}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "Account: ${ACCOUNT_ID}"
echo "Region:  ${AWS_REGION}"

echo "Deploying CloudFormation (creates ECR repo if missing, RDS, App Runner, API Gateway)..."
aws cloudformation deploy \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file infra.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      ProjectName="club-ops" \
      EnvName="demo" \
      ImageTag="${IMAGE_TAG}" \
      KioskToken="${KIOSK_TOKEN}" \
      DbPassword="${DB_PASSWORD}"

REPO_URI="$(aws cloudformation describe-stacks \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue" \
  --output text)"

echo "ECR repo URI: ${REPO_URI}"

echo "Ensuring repo exists (in case stack create is still finishing)..."
aws ecr describe-repositories --region "${AWS_REGION}" --repository-names "${ECR_REPO_NAME}" >/dev/null 2>&1 || \
  aws ecr create-repository --region "${AWS_REGION}" --repository-name "${ECR_REPO_NAME}" >/dev/null

echo "Logging into ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

echo "Building Docker image..."
docker build -t "${ECR_REPO_NAME}:${IMAGE_TAG}" -f services/api/Dockerfile .

echo "Tagging and pushing..."
docker tag "${ECR_REPO_NAME}:${IMAGE_TAG}" "${REPO_URI}:${IMAGE_TAG}"
docker push "${REPO_URI}:${IMAGE_TAG}"

echo "Done pushing. App Runner auto-deploys on new image."
aws cloudformation describe-stacks \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs" \
  --output table
