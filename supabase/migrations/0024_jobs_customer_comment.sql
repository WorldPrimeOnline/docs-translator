-- Add customer_comment column to jobs table for storing order notes from the client
alter table jobs add column if not exists customer_comment text;
