#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REPO_NAME="${ECR_REPO_NAME:-club-ops-api}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "Account: ${ACCOUNT_ID}"
echo "Region:  ${AWS_REGION}"

REPO_URI="${ECR_REGISTRY}/${ECR_REPO_NAME}"
echo "ECR repo URI: ${REPO_URI}"

echo "Ensuring repo exists..."
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
