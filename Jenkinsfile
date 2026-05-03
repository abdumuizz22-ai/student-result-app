pipeline {
    agent any

    environment {
        DOCKER_HUB_USER = 'muizz103'
        IMAGE_NAME = 'student-result-app'
        TEST_REPO = 'https://github.com/abdumuizz22-ai/edutrack-tests.git'
        TEST_IMAGE = 'muizz103/edutrack-tests:latest'
    }

    stages {
        stage('Clone Repository') {
            steps {
                echo 'Cloning application repository...'
                checkout scm
            }
        }

        stage('Build Docker Image') {
            steps {
                echo 'Building Docker image...'
                sh 'docker build -t ${DOCKER_HUB_USER}/${IMAGE_NAME}:latest .'
            }
        }

        stage('Push to Docker Hub') {
            steps {
                echo 'Pushing to Docker Hub...'
                withCredentials([usernamePassword(credentialsId: 'dockerhub-credentials', usernameVariable: 'USERNAME', passwordVariable: 'PASSWORD')]) {
                    sh 'docker login -u $USERNAME -p $PASSWORD'
                    sh 'docker push ${DOCKER_HUB_USER}/${IMAGE_NAME}:latest'
                }
            }
        }

        stage('Deploy with Docker Compose') {
            steps {
                echo 'Deploying application...'
                sh 'docker-compose -f docker-compose.jenkins.yml down || true'
                sh 'docker-compose -f docker-compose.jenkins.yml up -d'
                sh 'sleep 30'
            }
        }

        stage('Run Selenium Tests') {
            steps {
                echo 'Running Selenium tests in Docker container...'
                sh '''
                    rm -rf edutrack-tests
                    git clone ${TEST_REPO} edutrack-tests
                    cd edutrack-tests
                    docker build -t ${TEST_IMAGE} .
                    docker run --rm \
                        --network host \
                        ${TEST_IMAGE}
                '''
            }
        }
    }

    post {
        success {
            echo 'Pipeline completed successfully! All tests passed.'
        }
        failure {
            echo 'Pipeline failed! Check the logs for details.'
        }
    }
}
