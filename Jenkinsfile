/*
 * Jenkins pipeline for the SmartAttend AI automation suites.
 *
 * ASSUMED AGENT SETUP (one Linux agent with Docker + Node.js + Python 3.10):
 *   - Jenkins 2.4x with the "Allure Jenkins plugin" installed, and an
 *     "Allure Commandline" installation configured under
 *     Manage Jenkins -> Tools -> Allure Commandline (the plugin downloads it).
 *   - JDK 11+ on the agent: the Allure command line is a JVM application. That
 *     is why the HTML report is built here and not on a developer laptop.
 *   - Docker CLI usable by the jenkins user (the PostgreSQL container below).
 *   - Node.js 22 and Python 3.10 on PATH (or wrap the sh steps in
 *     `docker.image('node:22').inside { ... }` from the Docker plugin).
 *   - JUnit plugin for the trend chart (part of the default install).
 *
 * ASSUMED CREDENTIALS (Manage Jenkins -> Credentials, "Secret text", exact IDs):
 *   smartattend-e2e-admin-email    administrator login for the admin journeys
 *   smartattend-e2e-admin-password administrator password
 *   smartattend-api-test-email     account for the HTTP contract suite
 *   smartattend-api-test-password  its password
 *   Administrator passwords are never kept in the repository. Jenkins fails a
 *   build on an unknown credential ID, so if these four are not defined, delete
 *   the withCredentials blocks: the specs then skip the signed-in journeys and
 *   the pipeline still goes green.
 *
 * The faculty demo account published in README.md is not a secret and is used
 * directly in the environment block.
 */
pipeline {
    agent any

    options {
        timestamps()
        // One build at a time: the deployed demo allows 10 sign-ins per minute
        // and every login journey shares one faculty account.
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
        timeout(time: 60, unit: 'MINUTES')
    }

    environment {
        E2E_BASE_URL = "${env.E2E_BASE_URL ?: 'https://smartattend-ai-sblb.onrender.com'}"
        API_BASE_URL = "${env.E2E_BASE_URL ?: 'https://smartattend-ai-sblb.onrender.com'}"
        E2E_EMAIL = 'abhishek.mishra@faculty.edu'
        E2E_PASSWORD = 'SmartAttend2026'
        PG_CONTAINER = 'smartattend-test-db'
        // The engine uses the psycopg 3 driver that backend/requirements.txt pins;
        // a plain postgresql:// URL would make SQLAlchemy look for psycopg2.
        DATABASE_URL = 'postgresql+psycopg://smartattend:smartattend@localhost:5432/smartattend'
        TEST_DATABASE_URL = 'postgresql+psycopg://smartattend:smartattend@localhost:5432/smartattend_test'
        APP_ENV = 'test'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Python toolchain') {
            steps {
                // One virtualenv shared by the two pytest suites below.
                sh '''
                    python3.10 -m venv .venv-ci
                    .venv-ci/bin/pip install --upgrade pip
                    .venv-ci/bin/pip install -r backend/requirements-dev.txt
                    .venv-ci/bin/pip install httpx==0.28.1 jsonschema==4.23.0
                '''
            }
        }

        stage('Tests') {
            parallel {
                stage('Backend API tests') {
                    steps {
                        script {
                            // postgres:16-alpine matches the db service in
                            // docker-compose.yml. backend/tests/conftest.py runs
                            // alembic upgrade and TRUNCATEs the schema between
                            // tests, so real PostgreSQL is required.
                            sh """
                                docker rm -f ${PG_CONTAINER} >/dev/null 2>&1 || true
                                docker run -d --name ${PG_CONTAINER} \
                                  -e POSTGRES_USER=smartattend \
                                  -e POSTGRES_PASSWORD=smartattend \
                                  -e POSTGRES_DB=smartattend \
                                  -p 5432:5432 postgres:16-alpine
                            """
                            sh '''
                                for i in $(seq 1 30); do
                                  docker exec ${PG_CONTAINER} pg_isready -U smartattend -d smartattend && break
                                  sleep 2
                                done
                                docker exec ${PG_CONTAINER} psql -U smartattend -d postgres \
                                  -c "CREATE DATABASE smartattend_test" || true
                            '''
                            // APP_ENV=test refuses to start unless TEST_DATABASE_URL
                            // differs from DATABASE_URL, hence the second database.
                            // 101 tests; --alluredir feeds the report step below.
                            sh '.venv-ci/bin/pytest backend --alluredir=allure-results-api'
                        }
                    }
                }

                stage('Frontend unit tests') {
                    steps {
                        sh 'cd frontend && npm ci'
                        // 54 Vitest tests; JUnit XML lets Jenkins trend the run.
                        sh 'cd frontend && npm test -- --reporter=default --reporter=junit --outputFile.junit=reports/junit.xml'
                    }
                }
            }
        }

        stage('HTTP contract tests') {
            steps {
                // Read-only checks against the deployed instance: GETs plus one
                // login per session. The signed-in part skips when the two
                // credentials below are empty.
                withCredentials([
                    string(credentialsId: 'smartattend-api-test-email', variable: 'API_TEST_EMAIL'),
                    string(credentialsId: 'smartattend-api-test-password', variable: 'API_TEST_PASSWORD'),
                ]) {
                    sh '.venv-ci/bin/pytest api_contract --alluredir=allure-results-contract -p no:cacheprovider'
                }
            }
        }

        stage('Playwright specs') {
            steps {
                sh 'npm ci'
                // Playwright's own chromium: on a CI agent there is nothing to
                // gain from E2E_CHANNEL=chrome, which exists to avoid downloading
                // a browser on a locked-down laptop.
                sh 'npx playwright install --with-deps chromium'
                withCredentials([
                    string(credentialsId: 'smartattend-e2e-admin-email', variable: 'E2E_ADMIN_EMAIL'),
                    string(credentialsId: 'smartattend-e2e-admin-password', variable: 'E2E_ADMIN_PASSWORD'),
                ]) {
                    // --workers=1 keeps the run inside the 10 sign-ins/minute limit.
                    sh 'npx playwright test --workers=1'
                }
            }
        }

        stage('Gherkin scenarios') {
            steps {
                // bddgen turns features/*.feature into real Playwright test files
                // under features/.features-gen, then the runner executes them with
                // the dedicated BDD configuration.
                sh 'npm run bdd:codegen'
                sh 'npx playwright test -c playwright-bdd.config.ts --workers=1'
            }
        }
    }

    post {
        always {
            // One Allure report across every suite: pytest, the contract checks,
            // the Playwright specs and the Gherkin scenarios. This block is the
            // shape the pipeline Snippet Generator produces for the Allure plugin;
            // resultsPaths is a comma-separated list of allure-results directories.
            step([$class: 'AllureJenkinsPlugin',
                  commandlineInstallation: 'Allure Commandline',
                  jdkInstallation: 'jdk17',
                  reportName: 'SmartAttend AI - Allure report',
                  resultsPaths: 'allure-results-api, allure-results-contract, allure-results, allure-results-bdd',
                  singleReport: true,
                  debug: false])
            // Without the plugin the same report is a shell step (it still needs
            // the Allure CLI and a JDK on the agent):
            //   sh 'mkdir -p alluredir && for d in allure-results allure-results-*; do cp -r "$d"/* alluredir/ 2>/dev/null || true; done'
            //   sh 'allure generate alluredir --clean -o allure-report'
            //   archiveArtifacts artifacts: 'allure-report/**', allowEmptyArchive: true
            archiveArtifacts artifacts: 'playwright-report/**, playwright-report-bdd/**, frontend/reports/junit.xml', allowEmptyArchive: true
            junit allowEmptyResults: true, testResults: 'frontend/reports/junit.xml'
            sh 'docker rm -f ${PG_CONTAINER} || true'
        }
        unsuccessful {
            echo 'A suite is red: open the Allure report for this build, or the Playwright HTML report artifact for traces and screenshots of the failures.'
        }
    }
}
