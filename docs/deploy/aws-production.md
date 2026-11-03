# Moving to AWS for production (later, paid)

> **Outside the capstone.**
> The capstone allows no production deployment and nothing that costs the client.
> This document is for a possible later, paid engagement.
> Nothing here is to be set up before that engagement is agreed in writing.

The code is already portable.
Both apps are Docker images, the database is plain Postgres, settings come from environment variables, and storage uses the AWS SDK v3.
Moving means changing where things run, not rewriting the app.

Target region: **ap-southeast-2 (Sydney)**, the closest AWS region to Adelaide.

## Accounts

- The AWS account belongs to the client: her business name, her business email, her card.
- Turn on MFA for the root user, then stop using root.
- The developer gets an admin user (IAM Identity Center, or an IAM user with MFA).
- Set an AWS Budgets alert in the first hour, at a monthly amount she has agreed.
- The same applies to any Vercel, Resend or domain account: hers, with the developer invited.

## Options

### Compute for the API (and optionally the frontend)

| Option | What it is | Good for | Watch out for |
| --- | --- | --- | --- |
| **Lightsail containers** | A fixed monthly bundle: container, HTTPS endpoint and data transfer | The simplest setup and the most predictable bill | Fewer controls; no IAM role for the container, so storage uses access keys |
| **ECS on Fargate** | Containers on AWS's standard platform, behind an Application Load Balancer | Room to grow, IAM roles, autoscaling | More moving parts; the load balancer is a fixed cost |
| **ECS Express Mode** | ECS on Fargate with the load balancer, HTTPS certificate, scaling and logs created for you | ECS without the setup work | Same running costs as ECS on Fargate |

AWS App Runner is not an option.
It stopped accepting new customers on 30 April 2026, and AWS points former users to ECS Express Mode.

For one small business site, **Lightsail is the sensible default**.
Choose ECS if the client wants autoscaling, IAM roles or tighter AWS integration.

### Database

- **RDS for PostgreSQL**, `db.t4g.micro`, Single-AZ, 20 GB gp3, to start.
  Use the same major version as Neon (18) or newer.
  Turn on automated backups (7 days or more).
- **Lightsail managed PostgreSQL**, Standard plan, if the API runs on Lightsail.

Neither has a connection pooler in front, so `DATABASE_URL` and `DATABASE_URL_UNPOOLED` hold the same URL, as they do locally and in CI.

### Files

- **S3**, one private bucket, Block Public Access on.
  Bucket names are global, so it cannot be called `assets`; set `STORAGE_BUCKET` to the new name.
- The code works unchanged once `AWS_ENDPOINT_URL_S3` is removed: the SDK then talks to S3 itself, in the normal virtual-hosted style.
- Today the API only turns storage on when `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION` are all set.
  On Lightsail, that means an IAM user's access keys, limited to this one bucket.
  On ECS, a task role with no keys at all is better practice.
  That needs a small change to `backend/src/storage/storage.config.ts` before the move, so it accepts role credentials.

### Routing and cookies

Keep the browser on one site, so the `SameSite=Lax` login cookies keep working.
Two ways:

1. **CloudFront in front of everything** on `www.studiorags.com.au`.
   The default behaviour goes to the frontend; `/api/*` goes to the API with caching off and all cookies, headers and query strings forwarded.
2. **Subdomains**: `app.studiorags.com.au` for the frontend and `api.studiorags.com.au` for the API.
   They share the site `studiorags.com.au`, so Lax cookies still travel.
   The simplest version keeps the Next.js rewrite: set `API_ORIGIN=https://api.studiorags.com.au` and the browser code does not change.

Either way, count the proxies again and set `TRUST_PROXY` to match.
CloudFront then a load balancer is 2; a load balancer alone is 1.
If the browser's API calls go through the frontend container (option 2), that container is one more: browser, load balancer, frontend container, load balancer, API is 3.
The container counts because `frontend/Dockerfile` starts Next.js with `docker/forwarded-for.mjs`, which adds each caller's address to `X-Forwarded-For` as a proxy should.
Without it, Next.js passes the header on unchanged, and no `TRUST_PROXY` value is right.
Never expose the frontend container straight to the internet either; Next.js's own guidance is a reverse proxy in front.
Then repeat the check in [README.md](README.md#check-trust_proxy).

### Frontend

- **Stay on Vercel**, on the Pro plan, because Hobby is for non-commercial use only.
- Or **run `frontend/Dockerfile`** next to the API on Lightsail or ECS, and save the Vercel fee.

### Secrets and email

- **Secrets**: AWS Secrets Manager, or SSM Parameter Store SecureString parameters (standard ones are free).
  ECS injects either into the container as environment variables.
  Lightsail containers take environment variables directly in the service settings.
- **Email**: Amazon SES (verify the domain, set SPF, DKIM and DMARC, and request production access) or Resend, which the spec already names.

## Rough monthly costs

These are list prices, to show the size of the bill.
They are **not a quote**.
Price every option in the [AWS Pricing Calculator](https://calculator.aws/) before quoting the client.

The us-east-1 column is the commonly quoted list price; Sydney is usually higher.
The Sydney figures come from the AWS Price List API on 3 November 2026.
All figures are US dollars, before tax, for 730 hours a month.

| Item | us-east-1 | Sydney |
| --- | --- | --- |
| Fargate, 0.25 vCPU and 0.5 GB, running all month | about $9 | about $10.80 |
| Application Load Balancer, fixed part | about $16, plus LCUs | about $18.40, plus LCUs |
| Each public IPv4 address ($0.005 an hour) | $3.65 | $3.65 |
| RDS `db.t4g.micro` Single-AZ PostgreSQL | $11.68 | $18.25 |
| 20 GB gp3 storage for RDS | $2.30 | $2.76 |
| Lightsail container, Micro | $10 | check the calculator |
| Lightsail managed PostgreSQL, Standard | $15 | check the calculator |
| Vercel Pro, if the frontend stays on Vercel | $20 per member | $20 per member |

What that adds up to, roughly:

- **Lightsail API and database**: about $25 a month, plus Vercel Pro if used.
- **ECS on Fargate with RDS** in Sydney: about $60 a month, plus Vercel Pro if used.
  That assumes the load balancer's two public addresses and one for the task.

Avoid a NAT gateway.
It costs more than the whole app (about $33 a month in us-east-1, before data).
Run the tasks in public subnets with a public address instead, and let the security group accept traffic from the load balancer only.

Small extras: Route 53 hosted zone $0.50 a month, Secrets Manager $0.40 per secret a month, SES $0.10 per 1,000 emails.

## Moving, step by step

If staging holds only test data, skip steps 3 and 4.
Start production empty: the container runs the migrations, then seed the admin as the README describes.
Steps 3 and 4 are for a site that already holds real bookings.

1. **Create the AWS resources** in ap-southeast-2: the database, the bucket, the container service and the secrets.
   Push the API image to Amazon ECR (ECS) or to the Lightsail container service.
2. **Lower the DNS TTL** for the site's records to 5 minutes, a day ahead.
3. **Freeze and copy the database.**
   Suspend the Render service so nothing writes, then dump from Neon's **direct** URL.
   A dump through the pooler fails.
   Use a `pg_dump` at least as new as the server (18).

   ```sh
   (set -a; . ./.env.local; set +a
    pg_dump --format=custom --no-owner --no-acl \
      --file=studio_rags.dump "$DATABASE_URL_UNPOOLED")
   pg_restore --no-owner --no-acl --dbname="<RDS URL>" studio_rags.dump
   ```

4. **Copy the files.**
   The AWS CLI reads `AWS_ENDPOINT_URL_S3` from the environment, so with `.env.local` loaded it talks to Neon.
   Neon needs path-style addressing; set `s3 = addressing_style = path` in the profile the first command uses.

   ```sh
   (set -a; . ./.env.local; set +a; aws s3 sync s3://assets ./bucket-copy)
   aws s3 sync ./bucket-copy s3://<new-bucket-name> --profile <client-profile>
   ```

5. **Set the environment** on the new API:
   - `DATABASE_URL` and `DATABASE_URL_UNPOOLED`: the RDS (or Lightsail) URL, with `sslmode=require`.
   - `AWS_REGION=ap-southeast-2` and `STORAGE_BUCKET=<new-bucket-name>`; no `AWS_ENDPOINT_URL_S3`.
   - `CORS_ORIGIN` and `APP_URL`: the real site address.
   - New `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, two separate random values. Everyone signs in again once.
   - `TRUST_PROXY` for the new chain.
   - On the frontend: `API_ORIGIN` for the new API, and `SITE_ENV=production`, which removes the test banner and the noindex header.
6. **Run the migrations.**
   The container does it on start (`backend/docker-entrypoint.sh`), so starting the service is enough.
7. **Test on the AWS addresses** before DNS changes: the health report, a sign-in, a file upload.
8. **Cut over DNS** to CloudFront or the new endpoints.
9. **Keep Neon and Render untouched for a week** as a way back, then delete them.
