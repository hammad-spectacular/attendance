# School Fee Management Module V1

## Overview
Build a simple school fee management module inside the existing school management system. Keep it focused on tracking fee status for students and helping the admin monitor payments month by month.

## Goals
The module should help answer:
1. Which students have paid their fee for a selected month?
2. Which students have not paid?
3. Which students have partially paid?
4. How much fee is due, how much is paid, and when it was paid?
5. Show fee status on the student dashboard.

## Scope
- School system only
- No general business/store support
- No camera attendance or unrelated modules

## Database design

### A. Student Fee Setup
Create a table for each student's fee setup.

Fields:
- id
- student_id
- monthly_fee
- admission_fee (optional)
- transport_fee (optional)
- discount (optional)
- is_active
- created_at
- updated_at

Purpose:
Store the default fee structure for a student.

### B. Monthly Fee Record
Create a monthly fee record table for tracking fee status per student per month.

Fields:
- id
- student_id
- month_year (example: 2026-07)
- amount_due
- amount_paid
- status (unpaid, partial, paid, pending_approval)
- payment_date (nullable)
- proof_image_url (nullable)
- notes (nullable)
- approved_by (nullable)
- created_at
- updated_at

Rules:
- unpaid if amount_paid = 0
- partial if amount_paid > 0 and amount_paid < amount_due
- paid if amount_paid >= amount_due
- pending_approval only if proof upload is used and admin has not approved it yet

### C. Payment Log (optional but preferred)
Optional table for storing multiple payments.

Fields:
- id
- monthly_fee_record_id
- student_id
- amount
- payment_date
- payment_method
- proof_image_url (nullable)
- received_by
- notes (nullable)
- created_at

If this makes V1 too large, skip it and store payment directly in the monthly fee record.

## Admin Fee Dashboard
Create a Fee Dashboard page inside the admin panel.

### Top summary cards
- Total Students
- Total Due
- Total Collected
- Collection Rate

### Filters
- Search by student name
- Filter by class
- Filter by month
- Filter by fee status

### Main table columns
- Student Name
- Class
- Month
- Amount Due
- Amount Paid
- Status
- Payment Date
- Action button (View / Record Payment / Edit)

## Fee Structure / Student Fee Setup page
Create a simple admin page to define fee settings.

Features:
- Set fee structure per student or class
- Fields for:
  - monthly fee
  - admission fee
  - transport fee
  - discount
- Ability to edit/update later

## Record Payment page / modal
Create a simple payment entry flow.

Fields:
- Student
- Month
- Amount Due
- Amount Paid
- Payment Date
- Payment Method
- Notes (optional)
- Upload Receipt / Proof (optional)

Logic:
- amount_paid = 0 => unpaid
- amount_paid < amount_due => partial
- amount_paid >= amount_due => paid
- if proof upload is used and needs manual approval, status becomes pending_approval until approved

## Student Dashboard fee section
Add a My Fees section to the student dashboard.

It should show:
- Current month fee status
- Amount due
- Amount paid
- Payment date
- Recent fee history for previous months

Student view should be read-only.

## Roles and permissions
Support role-based permissions for:
- Admin
- Teacher
- Accountant / Fee Manager

Fee permissions:
- view fee dashboard
- create/edit fee structure
- record payment
- approve payment proof
- view student fee history

## UI expectations
Keep the design consistent with the existing school management system.

Use a clean admin fee dashboard, fee structure page, record payment modal, and student fee view.

## V1 boundaries
Do not build:
- full accounting ledger
- advanced invoice engine
- generic business/store support
- camera attendance
- face recognition
- dynamic custom dashboard builder
- complex finance reports beyond basic fee reports

## Build order
1. Create the database structure
2. Create fee structure / student fee setup page
3. Create admin fee dashboard with filters and summary cards
4. Create record payment flow and status logic
5. Add student dashboard My Fees section
6. Add permission checks for fee-related actions

## Expected outcome
By the end of this module, the system should allow:
- admin to set fee amounts
- admin to track fee month by month
- admin to mark paid / unpaid / partial
- optional receipt upload
- student to see fee status in dashboard
- fee manager/accountant role to manage payments if permissions are given
