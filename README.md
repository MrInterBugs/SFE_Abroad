# Loan Repayment Calculator

This project is a Student Loan Repayment Calculator that helps users estimate their monthly repayment amounts based on different country-specific salary thresholds and repayment plans. The application is built using Node.js, Express, and uses various middleware like Helmet for security, Rate Limiter for request throttling, and CSRF Protection to safeguard against cross-site request forgery.

## Table of Contents

- Features
- Prerequisites
- Installation
- Project Structure
- Usage
- API Endpoints
- Security
- Technologies Used
- License

## Features

- **Multiple Repayment Plans**: Supports different repayment plans (Plan 1, Plan 2, Plan 4).
- **Country-Specific Calculations**: Retrieves country-specific exchange rates and salary thresholds.
- **Rate Limiting**: Prevents abuse by limiting requests per IP address.
- **CSRF Protection**: Secure form submissions using CSRF tokens.
- **Cookie Management**: Persist user preferences for plan and country using cookies.
- **Security Best Practices**: Helmet for setting security-related HTTP headers.

## Prerequisites

Ensure you have the following installed:

- **Node.js** (v14 or higher)
- **npm** (v6 or higher)

## Installation

- **Clone the repository:**

```bash
git clone https://github.com/your-username/loan-repayment-calculator.git
cd loan-repayment-calculator
```

- **Install dependencies:**

```bash
npm install
```

- **Configure environment variables:** Create a .env file in the root directory and add any required environment variables (e.g., NODE_ENV, PORT).

- **Run the application:**

```bash
npm start
```

The application will be running at `http://localhost:3000`.


## Usage
### Home Page

When you visit the home page (/), you will see a form where you can select:

    Target Country: The country for which you want to calculate repayment.
    Salary in Local Currency: Your salary in the local currency of the selected country.
    Repayment Plan: Select from Plan 1, Plan 2, or Plan 4.

The form submits the data and returns the estimated monthly repayment.
### Calculate Loan Repayment

The /calculate endpoint handles POST requests. It calculates the monthly repayment based on the country's exchange rate, threshold salary, and the user's salary.
API Endpoints

    GET /: Displays the home page with the loan calculation form.
    POST /calculate: Processes the loan calculation and renders the result.
        Parameters:
            targetCountry: The selected country.
            salaryLocalCurrency: Salary in the local currency.
            selectedPlan: Chosen repayment plan (Plan 1, Plan 2, Plan 4).

## Security

- Rate Limiting: Each IP is limited to 5 requests per second to prevent abuse.
- Helmet: Security headers are set using Helmet's contentSecurityPolicy.
- CSRF Protection: All form submissions are protected using CSRF tokens.
- Cookies: Preferences for selected country and repayment plan are stored in HTTP-only, secure cookies.

## Technologies Used

- Node.js: JavaScript runtime.
- Express.js: Web framework for building the API and serving views.
- Axios: For making HTTP requests to retrieve country-specific data.
- Cheerio: For scraping and parsing the HTML from external sites.
- Rate Limiter Flexible: To prevent abuse through rate limiting.
- Helmet: Secures HTTP headers to prevent various web vulnerabilities.
- EJS: Templating engine for rendering HTML views.
- CSRF Protection: Ensures safe form submissions.
- Logger: Custom logger for logging server events and errors.

## License

This project is licensed under the Apache 2.0 License.
