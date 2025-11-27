# AWS STS Setup Guide

Quick guide to configure AWS STS for temporary databank access credentials.

## Step 1: Create IAM Role

Create a role named `DatabanksTemporaryAccessRole` (or your preferred name).

## Step 2: Add Trust Policy to Role

Edit the role's trust policy to allow your API user to assume it:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::YOUR_ACCOUNT_ID:user/YOUR_API_USER"
    },
    "Action": "sts:AssumeRole"
  }]
}
```

Replace `YOUR_ACCOUNT_ID` and `YOUR_API_USER` with your values.

## Step 3: Add S3 Permissions to Role

Create an inline policy on the role with S3 access:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:*"],
    "Resource": ["arn:aws:s3:::YOUR_BUCKET/*", "arn:aws:s3:::YOUR_BUCKET"]
  }]
}
```

Replace `YOUR_BUCKET` with your S3 bucket name.

## Step 4: Add AssumeRole Permission to API User

Add this policy to your API's IAM user:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "sts:AssumeRole",
    "Resource": "arn:aws:iam::YOUR_ACCOUNT_ID:role/DatabanksTemporaryAccessRole"
  }]
}
```

Replace `YOUR_ACCOUNT_ID` with your AWS account ID.



