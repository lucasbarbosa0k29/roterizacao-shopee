-- Add a short-lived period for atomic request throttling.
ALTER TYPE "ApiUsagePeriodType" ADD VALUE 'MINUTE';
