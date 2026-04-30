# Use the official Node.js image.
FROM node:25-alpine

# Build tools required for better-sqlite3 native compilation.
RUN apk add --no-cache python3 make g++

# Create and set the working directory.
WORKDIR /usr/src/app

# Copy the package.json and package-lock.json files.
COPY ./student-loan-repayment/package.json ./package.json

# Install the app dependencies and create the SQLite cache directory.
RUN npm install && mkdir -p /usr/src/app/data

# Copy all other files.
COPY ./student-loan-repayment ./

# Make sure the tests pass (.env mounted as a secret — not stored in the image).
RUN --mount=type=secret,id=env,dst=/usr/src/app/.env npm test

# Expose the main sever port.
EXPOSE 3000

# Specify the command to run the application.
CMD [ "node", "app.js" ]
