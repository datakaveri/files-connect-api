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
                sh """trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed ${mainImage.imageName()}"""
                sh """trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed ${reportImage.imageName()}"""
                sh """trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed ${zipImage.imageName()}"""

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
                reportFiles: 'trivy-fs-report.txt, trivy-main.txt, trivy-report.txt, trivy-zip.txt',
                reportName: 'Trivy Reports'
              ])
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

            stage('EKS Helm deployment') {
              steps {
                script {
                  def deployTag = "1.0.1-${env.GIT_HASH}"
                  sh "ssh ubuntu@dev-eks 'cd v2-deployments/iudx/iudx-installer/K8s-deployment/Charts/file-connect-api && helm upgrade files-connect-api . -n files-connect-api --atomic --timeout 5m --reuse-values --set image.registry=ghcr.io --set image.repository=${devRegistryMain} --set image.tag=${deployTag} --set workers.report-worker.image.repository=${devRegistryReport} --set workers.report-worker.image.tag=${deployTag} --set workers.zip-worker.image.repository=${devRegistryZip} --set workers.zip-worker.image.tag=${deployTag}'"
                }
              }
              post{
                failure{
                  error "Failed to deploy image to EKS via Helm"
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
