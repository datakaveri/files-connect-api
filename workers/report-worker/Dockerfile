# Use an official Python runtime as a parent image
FROM public.ecr.aws/lambda/python:3.10

# Patch base OS packages before installing Python dependencies.
RUN yum update -y && yum clean all && rm -rf /var/cache/yum

# Copy requirements.txt
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip setuptools==82.0.1 wheel==0.47.0
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of code
COPY . .

# Set the entrypoint
CMD ["lambda_handler.lambda_handler"]  
