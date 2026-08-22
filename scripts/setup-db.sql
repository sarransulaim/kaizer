-- Local development database setup.
--
-- Creates a dedicated `kaizr` role rather than running the app as the postgres
-- superuser. Safe to re-run: the role password is reset and the database is
-- only created if missing.
--
-- The password is read from the environment rather than written here, so that
-- no credential is ever committed. Use the same value as the password in the
-- DATABASE_URL in your .env.local:
--
--   KAIZR_DB_PASSWORD='...' psql -U postgres -h localhost -p 5432 -f scripts/setup-db.sql
--
-- Requires psql 16 or newer for \getenv.

\set ON_ERROR_STOP on

\getenv kaizr_password KAIZR_DB_PASSWORD

\if :{?kaizr_password}
\else
  \warn 'KAIZR_DB_PASSWORD is not set. Export it (matching the password in .env.local) and run this again.'
  \quit
\endif

-- Create the role if it is missing, then always reset its password, so the
-- script converges on whatever KAIZR_DB_PASSWORD currently is.
--
-- Built as strings and run through \gexec because psql does not interpolate
-- variables inside a dollar-quoted DO block, and `format(%L)` is what keeps a
-- password containing quotes from breaking the statement.
SELECT 'CREATE ROLE kaizr LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kaizr')\gexec

SELECT format('ALTER ROLE kaizr WITH LOGIN PASSWORD %L', :'kaizr_password')\gexec

SELECT 'CREATE DATABASE kaizr_dev OWNER kaizr'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kaizr_dev')\gexec

\connect kaizr_dev

ALTER SCHEMA public OWNER TO kaizr;
GRANT ALL ON SCHEMA public TO kaizr;

\echo ''
\echo 'Ready: database kaizr_dev, role kaizr.'
