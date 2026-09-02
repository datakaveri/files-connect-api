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
            return env.BRANCH_NAME == 'stable/v2.3' || env.BRANCH_NAME.startsWith('PR-')
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

              mainImage = docker.build(devRegistryMain, "--pull -f ./infra/Dockerfile .")
              reportImage = docker.build(devRegistryReport, "--pull -f ./workers/report-worker/Dockerfile.worker ./workers/report-worker")
              zipImage = docker.build(devRegistryZip, "--pull -f ./workers/zip-worker/Dockerfile ./workers/zip-worker")
            }
          }
        }

        stage('Trivy Scan and Report') {
          steps {
            script {
              try {
                sh "trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed ${mainImage.imageName()}"
                sh "trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed ${reportImage.imageName()}"
                sh "trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed ${zipImage.imageName()}"

                sh "trivy image --output trivy-main-report.txt ${mainImage.imageName()}"
                sh "trivy image --output trivy-report-worker-report.txt ${reportImage.imageName()}"
                sh "trivy image --output trivy-zip-worker-report.txt ${zipImage.imageName()}"
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
                reportFiles: 'trivy-fs-report.txt, trivy-main-report.txt, trivy-report-worker-report.txt, trivy-zip-worker-report.txt',
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

        stage('Push Images') {
          when {
            expression {
              return env.BRANCH_NAME == 'stable/v2.3'
            }
          }
          steps {
            script {
              def tagSuffix = ''
              if (env.CONFIG_CHANGED == 'true') {
                tagSuffix += '-C'
              }
              if (env.MIGRATION_CHANGED == 'true') {
                tagSuffix += '-M'
              }
              docker.withRegistry(registryUri, registryCredential) {
                mainImage.push("v2.3.RC1-${env.GIT_HASH}${tagSuffix}")
                reportImage.push("v2.3.RC1-${env.GIT_HASH}${tagSuffix}")
                zipImage.push("v2.3.RC1-${env.GIT_HASH}${tagSuffix}")
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
        if (env.BRANCH_NAME == 'stable/v2.3')
        emailext recipientProviders: [buildUser(), developers()],
        to: '$AAA_RECIPIENTS, $DEFAULT_RECIPIENTS',
        subject: '$PROJECT_NAME - Build # $BUILD_NUMBER - $BUILD_STATUS!',
        body: '''$PROJECT_NAME - Build # $BUILD_NUMBER - $BUILD_STATUS:
Check console output at $BUILD_URL to view the results.'''
      }
    }
  }
}
