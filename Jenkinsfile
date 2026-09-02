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
            changeset ".env.example"
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

        stage('Detect config/migration change') {
          when {
            not { changeRequest() }
          }
          steps {
            script {
              def baseCommit = env.GIT_PREVIOUS_SUCCESSFUL_COMMIT
              if (!baseCommit) {
                baseCommit = sh(script: 'git rev-list --max-parents=0 HEAD | tail -1', returnStdout: true).trim()
              }

              def changedFiles = sh(
                script: "git diff --name-only ${baseCommit} HEAD",
                returnStdout: true
              ).trim().split('\n') as List

              env.CONFIG_CHANGED = changedFiles.contains('.env.example') ? 'true' : 'false'
              // No DB migration mechanism exists in this repo (no db/migration
              // dir, no Prisma/Knex/TypeORM) — always false. Kept as an env
              // var for interface parity with the other API server Jenkinsfiles.
              env.MIGRATION_CHANGED = 'false'

              echo "Diffing against ${baseCommit} (last successful build's commit): config changed=${env.CONFIG_CHANGED}, migration changed=${env.MIGRATION_CHANGED}"
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
                  def tagSuffix = ''
                  if (env.CONFIG_CHANGED == 'true') {
                    tagSuffix += '-C'
                  }
                  if (env.MIGRATION_CHANGED == 'true') {
                    tagSuffix += '-M'
                  }
                  env.IMAGE_TAG = "1.0.1-${env.GIT_HASH}${tagSuffix}"
                  docker.withRegistry(registryUri, registryCredential) {
                    mainImage.push(env.IMAGE_TAG)
                    reportImage.push(env.IMAGE_TAG)
                    zipImage.push(env.IMAGE_TAG)
                  }
                }
              }
            }

            stage('EKS Helm deployment') {
              steps {
                script {
                  sh "ssh ubuntu@dev-eks 'cd v2-deployments/iudx/iudx-installer/K8s-deployment/Charts/file-connect-api && helm upgrade files-connect-api . -n files-connect-api --rollback-on-failure --timeout 5m --reuse-values --set image.registry=ghcr.io --set image.repository=${devRegistryMain} --set image.tag=${env.IMAGE_TAG} --set workers.report-worker.image.repository=${devRegistryReport} --set workers.report-worker.image.tag=${env.IMAGE_TAG} --set workers.zip-worker.image.repository=${devRegistryZip} --set workers.zip-worker.image.tag=${env.IMAGE_TAG}'"
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
