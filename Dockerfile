# Use the official Node.js image.
FROM node:18-alpine

# Create and set the working directory.
WORKDIR /usr/src/app

# Copy the package.json and package-lock.json files.
COPY ./student-loan-repayment/package.json ./package.json

# Install the app dependencies.
RUN npm install

COPY ./student-loan-repayment ./

EXPOSE 3000

# Specify the command to run the application.
CMD [ "node", "app.js" ]
