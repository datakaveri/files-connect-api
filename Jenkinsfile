pipeline {
  environment {
    devRegistryMain = 'ghcr.io/datakaveri/file-connect-api-minio'
    devRegistryReport = 'ghcr.io/datakaveri/file-connect-api-minio-worker-1'
    devRegistryZip = 'ghcr.io/datakaveri/file-connect-api-minio-worker'
    registryUri = 'https://ghcr.io'
    registryCredential = 'datakaveri-ghcr'
    GIT_HASH = GIT_COMMIT.take(7)
  }

  agent { 
    node {
      label 'slave1' 
    }
  }

  stages {

    stage('Conditional Execution') {
      when {
        allOf {
          anyOf {
            changeset "infra/**"
            changeset "workers/**"
            changeset "src/**"
            changeset "package.json"
            changeset "pnpm-lock.yaml"
            triggeredBy cause: 'UserIdCause'
          }
          expression {
            return env.BRANCH_NAME == 'dev' || env.BRANCH_NAME.startsWith('PR-');
          }
        }
      }

      stages {

        stage('Trivy Code Scan (Dependencies)') {
          steps {
            script {
              sh '''
                trivy fs --scanners vuln,secret,misconfig --output trivy-fs-report.txt .
              '''
            }
          }
        }

        stage('Building images') {
          steps{
            script {
              echo 'Pulled - ' + env.GIT_BRANCH

              mainImage = docker.build(devRegistryMain, "-f ./infra/Dockerfile .")
              reportImage = docker.build(devRegistryReport, "-f ./workers/report-worker/Dockerfile.worker ./workers/report-worker")
              zipImage = docker.build(devRegistryZip, "-f ./workers/zip-worker/Dockerfile ./workers/zip-worker")
            }
          }
        }
        
        stage('Trivy Scan and Report') {
          steps {
            script {
              try {
                // Scan main image
                sh """
                trivy image \
                  --exit-code 1 \
                  --severity HIGH,CRITICAL \
                  --ignore-unfixed \
                  ${mainImage.imageName()}
                """

                 // Scan report worker image
                 sh """
                 trivy image \
                   --exit-code 1 \
                   --severity HIGH,CRITICAL \
                   --ignore-unfixed \
                   ${reportImage.imageName()}
                 """

                 // Scan zip worker image
                 sh """
                 trivy image \
                   --exit-code 1 \
                   --severity HIGH,CRITICAL \
                   --ignore-unfixed \
                   ${zipImage.imageName()}
                 """

                // Reports
                sh "trivy image --output trivy-main.txt ${mainImage.imageName()}"
                sh "trivy image --output trivy-report.txt ${reportImage.imageName()}"
                sh "trivy image --output trivy-zip.txt ${zipImage.imageName()}"

               } catch (Exception e) {
               echo "Trivy scan failed due to high or critical vulnerabilities."
               throw e
              }
            }
          }
          post {
            always {
              archiveArtifacts artifacts: 'trivy-*.txt', allowEmptyArchive: true
              publishHTML(target: [
                allowMissing: true,
                keepAll: true,
                reportDir: '.',
                reportFiles: 'trivy-fs-report.txt, trivy-main.txt, trivy-report.txt, trivy-zip.txt'
                reportName: 'Trivy Reports'
              ])
            }
          }
        }
      } 

        stage('Continuous Deployment') {
          when {
            expression {
              return env.BRANCH_NAME == 'dev'
            }
          }

          stages {

            stage('Push Images') {
              steps {
                script {
                  docker.withRegistry(registryUri, registryCredential) {
                    mainImage.push("1.0.1-${env.GIT_HASH}")
                    reportImage.push("1.0.1-${env.GIT_HASH}")
                    zipImage.push("1.0.1-${env.GIT_HASH}")
                  }
                }
              }
            }

            stage('Docker Swarm deployment') {
              steps {
                script {

                  sh "ssh azureuser@docker-swarm 'docker service update file-server-minio-iudx-v2_file-server-minio-iudx-v2 --image ghcr.io/datakaveri/file-connect-api-minio:1.0.1-${env.GIT_HASH}'"

                  sh "ssh azureuser@docker-swarm 'docker service update file-server-minio-iudx-v2_filer-server-iudx-v2-report-worker --image ghcr.io/datakaveri/file-connect-api-minio-worker-1:1.0.1-${env.GIT_HASH}'"

                  sh "ssh azureuser@docker-swarm 'docker service update file-server-minio-iudx-v2_filer-server-iudx-v2-zip-worker --image ghcr.io/datakaveri/file-connect-api-minio-worker:1.0.1-${env.GIT_HASH}'"

                  sh 'sleep 15'

                  sh '''#!/bin/bash 
                  response_code=$(curl -s -o /dev/null -w '%{http_code}\\n' --connect-timeout 5 --retry 5 --retry-connrefused -XGET https://v2.dev.file.iudx.io/apis)

                  if [[ "$response_code" -ne "200" ]]
                  then
                    echo "Health check failed"
                    exit 1
                  else
                    echo "Health check complete; Server is up."
                    exit 0
                  fi
                  '''
                }
              }
              post{
                failure{
                  error "Failed to deploy image in Docker Swarm"
                }
              }
            }

          }
        }

      }
    }

  }

  post{
    failure{
      script{
        if (env.BRANCH_NAME == 'dev')
        emailext recipientProviders: [buildUser(), developers()],
        to: '$AAA_RECIPIENTS, $DEFAULT_RECIPIENTS',
        subject: '$PROJECT_NAME - Build # $BUILD_NUMBER - $BUILD_STATUS!',
        body: '''$PROJECT_NAME - Build # $BUILD_NUMBER - $BUILD_STATUS:
Check console output at $BUILD_URL to view the results.'''
      }
    }
  }
}
