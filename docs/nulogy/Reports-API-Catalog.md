# Nulogy Reports API Catalog

Generated: `2026-03-26T14:41:24.713Z`

Source HTML: `/Users/aj/Downloads/Reports API Documentation _ Nulogy.html`

Total reports: **36**

## Report Summary

| Report | Code | Max rows | Data fields | Fixed fields | Filter fields | Date-like filters |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| BOM Report | `bom` | 250000 | 15 | 0 | 13 | `finalized_at`, `release_date` |
| Canned Inventory Transaction History Report | `canned_inventory_transaction_history` | 250000 | 15 | 0 | 13 | `created_at`, `expiry_date` |
| Consumption by Lot Report | `consumption_by_lot` | 60000 | 29 | 6 | 14 | `consumed_at`, `consumed_date`, `finished_good_expiry_date`, `subcomponent_expiry_date` |
| Cycle Count Accuracy Report | `cycle_count_accuracy` | 60000 | 21 | 1 | 15 | `closed_at`, `created_at`, `expiry_date`, `performed_at` |
| Cycle Count Discrepancy Report | `cycle_count_discrepancy` | 60000 | 17 | 4 | 10 | `closed_at`, `created_at`, `expiry_date` |
| Cycle Count History Report | `cycle_count_history` | 60000 | 7 | 0 | 6 | `performed_at` |
| Estimate Report | `estimate_report` | 60000 | 10 | 0 | 9 |  |
| Inbound Stock Transfer Report | `inbound_stock_transfer` | 60000 | 32 | 0 | 19 | `created_at`, `expiry_date`, `transferred_at` |
| Inbound Stock Transfer Order Report | `inbound_stock_transfer_order` | 60000 | 37 | 0 | 22 | `created_at`, `deliver_at` |
| Inventory Adjustment Report | `inventory_adjustment` | 60000 | 46 | 0 | 36 | `adjusted_expiry`, `adjustment_date`, `created_at`, `initial_expiry`, `initial_received_date` |
| Inventory Snapshot Report | `inventory_snapshot` | 60000 | 24 | 1 | 13 | `expiry_date`, `snapshot_at` |
| Invoice Report | `invoice` | 60000 | 38 | 0 | 16 | `invoiced_at`, `paid_at` |
| Item Master Report | `item_master` | 150000 | 78 | 0 | 11 | `created_at`, `updated_at` |
| Job Downtime Report | `job_downtime` | 60000 | 40 | 0 | 21 | `actual_job_end_at`, `actual_job_start_at`, `downtime_end_at`, `downtime_start_at` |
| Job Productivity Report | `job_productivity` | 60000 | 70 | 0 | 25 | `actual_job_end_at`, `actual_job_start_at`, `scheduled_start_at` |
| Job Profitability Report | `job_profitability` | 60000 | 108 | 0 | 28 | `actual_job_end_at`, `actual_job_start_at`, `invoiced_at` |
| Labor Report | `labor` | 60000 | 34 | 0 | 15 | `clock_in_at`, `clock_out_at` |
| Lot Code Audit Report | `lot_code_audit` | 60000 | 7 | 0 | 7 | `job_start_at`, `subcomponent_expiry_date` |
| Move Transaction Report | `move_transaction` | 60000 | 35 | 0 | 20 | `ended_at`, `expiry_date`, `requested_at`, `started_at`, `time_completed_at` |
| Outbound Stock Transfer Report | `outbound_stock_transfer` | 60000 | 40 | 0 | 22 | `created_at`, `expiry_date`, `transferred_at` |
| Pallet Aging | `pallet_aging` | 60000 | 36 | 0 | 16 | `stored_since` |
| Pallet Storage | `pallet_storage` | 250000 | 11 | 3 | 13 | `stored_since` |
| Picked Inventory Report | `picked_inventory` | 60000 | 33 | 0 | 20 | `date_picked_at`, `expiry_date`, `pick_started_at` |
| Production Report | `production` | 60000 | 34 | 0 | 20 | `actual_job_end_at`, `actual_job_start_at`, `expiry_date`, `produced_at` |
| Work Order Status Report | `project_status` | 60000 | 51 | 0 | 35 | `created_at`, `due_date_at`, `fixed_expiry_date`, `last_job_completed_at`, `planned_start_at` |
| Receipt Item Report | `receipt_item` | 60000 | 63 | 0 | 29 | `expiry_date`, `planned_receipt_expected_receive_at`, `received_at` |
| Receive Order Report | `receive_order` | 60000 | 33 | 1 | 22 | `actual_ship_at`, `expected_delivery_at`, `expected_ship_at`, `ro_date_at` |
| Reconciliation Report | `reconciliation` | 60000 | 42 | 2 | 18 | `reconciled_date` |
| Reject Report | `reject` | 60000 | 43 | 0 | 18 | `actual_job_end_at`, `actual_job_start_at`, `expiry_date`, `rejected_at` |
| Reject Percentage Report | `reject_percentage` | 60000 | 29 | 0 | 12 | `rejected_at` |
| Scenario Report | `scenario_report` | 60000 | 63 | 0 | 15 | `created_at`, `effective_date_at`, `updated_at` |
| Ship Order Report | `ship_order` | 60000 | 34 | 0 | 15 | `expected_ship_at`, `ship_order_created_at`, `shipped_at` |
| Shipment Item Report | `shipment_item` | 60000 | 71 | 0 | 38 | `actual_ship_at`, `created_at`, `ship_order_date_at`, `ship_order_expected_ship_at`, `shipment_expected_ship_at` |
| UoM Ratios Report | `uom_ratios` | 125000 | 5 | 0 | 2 |  |
| Weekly Consumption Report | `weekly_consumption` | 60000 | 29 | 3 | 10 | `consumed_at`, `consumed_date`, `expiry_date` |
| Weekly Inventory Adjustment Summary Report | `weekly_inventory_adjustment_summary` | 60000 | 19 | 0 | 9 | `created_at`, `expiry_date` |

## Shared Fields

| Field | Reports |
| --- | ---: |
| `item_code` | 26 |
| `item_description` | 25 |
| `item_category_name` | 24 |
| `item_family_name` | 23 |
| `item_type_name` | 23 |
| `item_gtin` | 20 |
| `item_upc` | 20 |
| `item_alternate_code_1` | 19 |
| `item_alternate_code_2` | 19 |
| `site_name` | 19 |
| `project_code` | 17 |
| `expiry_date` | 15 |
| `lot_code` | 15 |
| `unit_of_measure` | 13 |
| `created_at` | 12 |
| `customer_name` | 12 |
| `item_class` | 12 |
| `pallet_number` | 12 |
| `project_id` | 12 |
| `project_reference_1` | 12 |
| `project_reference_2` | 12 |
| `project_reference_3` | 12 |
| `project_reference_4` | 12 |
| `project_reference_5` | 12 |
| `job_id` | 10 |

## BOM Report

- Anchor: `bom`
- Report code: `bom`
- Maximum rows returned: 250 Thousand
- Data fields: 15
- Fixed fields: 0
- Filter fields: 13
- Date-like filters: `finalized_at`, `release_date`

### Data Fields

| Field | Label |
| --- | --- |
| `finalized_at` | Finalized At |
| `finalizing_user_login` | Finalizing User Login |
| `finalizing_user_name` | Finalizing User Name |
| `finished_good_code` | Finished Good Code |
| `finished_good_unit_quantity` | Finished Good Unit Quantity |
| `finished_good_uom` | Finished Good Uom |
| `optional` | Optional |
| `position` | Position |
| `priority` | Priority |
| `release_date` | Release Date |
| `subcomponent_code` | Subcomponent Code |
| `subcomponent_unit_quantity` | Subcomponent Unit Quantity |
| `subcomponent_uom` | Subcomponent Uom |
| `substitute_for` | Substitute For |
| `version_name` | Version Name |

### Filter Fields

| Field |
| --- |
| `account_id` |
| `customer` |
| `finalized_at` |
| `finalizing_user_login` |
| `finalizing_user_name` |
| `inactive` |
| `is_subcomponent` |
| `item_category` |
| `item_family` |
| `item_type` |
| `release_date` |
| `vendor` |
| `version_name` |

## Canned Inventory Transaction History Report

- Anchor: `canned_inventory_transaction_history`
- Report code: `canned_inventory_transaction_history`
- Maximum rows returned: 250 Thousand
- Data fields: 15
- Fixed fields: 0
- Filter fields: 13
- Date-like filters: `created_at`, `expiry_date`

### Data Fields

| Field | Label |
| --- | --- |
| `base_quantity_uom_short_label` | Base UOM |
| `base_quantity_value` | Base Quantity |
| `created_at` | Created at |
| `expiry_date` | Expiry date |
| `id` | ID |
| `inventory_transaction` | Transaction |
| `item_code` | Item code |
| `item_description` | Item Description |
| `location_name` | Location |
| `lot_code` | Lot code |
| `pallet` | Pallet |
| `produced_from_work_order` | Work Order Code |
| `status` | Inventory Status |
| `transaction_quantity_uom_short_label` | Transaction UOM |
| `transaction_quantity_value` | Transaction Quantity |

### Filter Fields

| Field |
| --- |
| `base_quantity_uom_short_label` |
| `base_quantity_value` |
| `created_at` |
| `expiry_date` |
| `id` |
| `item_code` |
| `item_description` |
| `location_name` |
| `lot_code` |
| `produced_from_work_order` |
| `status` |
| `transaction_quantity_uom_short_label` |
| `transaction_quantity_value` |

## Consumption by Lot Report

- Anchor: `consumption_by_lot`
- Report code: `consumption_by_lot`
- Maximum rows returned: 60 Thousand
- Data fields: 29
- Fixed fields: 6
- Filter fields: 14
- Date-like filters: `consumed_at`, `consumed_date`, `finished_good_expiry_date`, `subcomponent_expiry_date`

### Data Fields

| Field | Label |
| --- | --- |
| `actual_job_end` | Actual job end date |
| `actual_job_start` | Actual job start date |
| `consumed_at` | Consumed at |
| `consumed_date` | Consumed date |
| `customer` | Customer |
| `finished_good_expiry_date` | Finished good expiry date |
| `finished_good_item_category` | Finished good item category name |
| `finished_good_item_family` | Finished good item Family name |
| `finished_good_item_type` | Finished good item type name |
| `finished_good_lot_code` | Finished good lot code |
| `finished_good_pallet` | Finished good pallet number |
| `job_id` | Job id |
| `job_reconciliation_status` | Job reconciliation status |
| `job_reference` | Job reference |
| `line` | Line name |
| `project_code` | Work Order code |
| `project_id` | Work Order id |
| `project_reference_1` | Work Order reference 1 |
| `project_reference_2` | Work Order reference 2 |
| `project_reference_3` | Work Order reference 3 |
| `project_reference_4` | Work Order reference 4 |
| `project_reference_5` | Work Order reference 5 |
| `subcomponent_consumption_pallet` | Subcomponent pallet number |
| `subcomponent_expiry_date` | Subcomponent expiry date |
| `subcomponent_item_category` | Subcomponent item category name |
| `subcomponent_item_family` | Subcomponent item family name |
| `subcomponent_item_type` | Subcomponent item type name |
| `subcomponent_item_vendor` | Subcomponent item vendor name |
| `subcomponent_lot_code` | Subcomponent lot code |

### Fixed Fields

| Field | Label |
| --- | --- |
| `finished_good_item_code` | Finished good code |
| `finished_good_quantity_produced` | Finished good quantity produced |
| `finished_good_unit_of_measure_label` | Finished good unit of measure |
| `subcomponent_item_code` | Subcomponent Item code |
| `subcomponent_quantity_consumed` | Subcomponent quantity consumed |
| `subcomponent_unit_of_measure_label` | Subcomponent unit of measure |

### Filter Fields

| Field |
| --- |
| `consumed_at` |
| `consumed_date` |
| `customer` |
| `finished_good_expiry_date` |
| `finished_good_item_code` |
| `finished_good_lot_code` |
| `finished_good_pallet` |
| `job_id` |
| `project_code` |
| `project_id` |
| `subcomponent_consumption_pallet` |
| `subcomponent_expiry_date` |
| `subcomponent_item_code` |
| `subcomponent_lot_code` |

## Cycle Count Accuracy Report

- Anchor: `cycle_count_accuracy`
- Report code: `cycle_count_accuracy`
- Maximum rows returned: 60 Thousand
- Data fields: 21
- Fixed fields: 1
- Filter fields: 15
- Date-like filters: `closed_at`, `created_at`, `expiry_date`, `performed_at`

### Data Fields

| Field | Label |
| --- | --- |
| `closed_at` | Date Closed |
| `cost_difference` | Cost Difference |
| `cost_difference_percentage` | Cost Difference % |
| `counted_by` | Counted By |
| `created_at` | Date Created |
| `customer_name` | Customer Name |
| `cycle_count_id` | Cycle Count ID |
| `cycle_count_notes` | Cycle Count Notes |
| `expiry_date` | Expiry Date |
| `inventory_category` | Inventory Category |
| `inventory_status` | Inventory Status |
| `location_name` | Location Name |
| `lot_code` | Lot Code |
| `pallet_number` | Pallet Number |
| `performed_at` | Date Performed |
| `physical_count` | Physical Count |
| `quantity_difference` | Quantity Difference |
| `quantity_difference_percentage` | Quantity Difference % |
| `signed_off_by` | Signed Off By |
| `system_count` | System Count |
| `unit_of_measure` | Unit of Measure |

### Fixed Fields

| Field | Label |
| --- | --- |
| `item_code` | Item Code |

### Filter Fields

| Field |
| --- |
| `closed_at` |
| `counted_by` |
| `created_at` |
| `customer_name` |
| `cycle_count_id` |
| `cycle_count_notes` |
| `expiry_date` |
| `inventory_category` |
| `inventory_status` |
| `item_code` |
| `location_name` |
| `lot_code` |
| `pallet_number` |
| `performed_at` |
| `signed_off_by` |

## Cycle Count Discrepancy Report

- Anchor: `cycle_count_discrepancy`
- Report code: `cycle_count_discrepancy`
- Maximum rows returned: 60 Thousand
- Data fields: 17
- Fixed fields: 4
- Filter fields: 10
- Date-like filters: `closed_at`, `created_at`, `expiry_date`

### Data Fields

| Field | Label |
| --- | --- |
| `closed_at` | Date Closed |
| `cost_per_unit` | Cost Per Unit |
| `counted_by` | Counted By |
| `created_at` | Date Created |
| `cycle_count_id` | Cycle Count ID |
| `cycle_count_row_number` | Cycle Count Row Number |
| `expiry_date` | Expiry Date |
| `inventory_category` | Inventory Category |
| `inventory_status` | Inventory Status |
| `item_customer` | Item Customer |
| `location_name` | Location |
| `lot_code` | Lot Code |
| `notes` | Notes |
| `pallet_number` | Pallet Number |
| `quantity` | Unit Quantity |
| `signed_off_by` | Signed Off By |
| `unit_of_measure` | Unit of Measure |

### Fixed Fields

| Field | Label |
| --- | --- |
| `discrepancy_type` | Discrepancy Type |
| `item_code` | Item Code |
| `new_value` | New Value |
| `old_value` | Old Value |

### Filter Fields

| Field |
| --- |
| `closed_at` |
| `counted_by` |
| `created_at` |
| `cycle_count_id` |
| `expiry_date` |
| `item_code` |
| `item_customer` |
| `location_name` |
| `lot_code` |
| `signed_off_by` |

## Cycle Count History Report

- Anchor: `cycle_count_history`
- Report code: `cycle_count_history`
- Maximum rows returned: 60 Thousand
- Data fields: 7
- Fixed fields: 0
- Filter fields: 6
- Date-like filters: `performed_at`

### Data Fields

| Field | Label |
| --- | --- |
| `accuracy` | Accuracy |
| `counted_by` | Counted by |
| `notes` | Notes |
| `performed_at` | Performed date |
| `sign_off_user` | Sign off user |
| `units_changed` | Units changed |
| `value_changed` | Value changed |

### Filter Fields

| Field |
| --- |
| `accuracy` |
| `counted_by` |
| `performed_at` |
| `sign_off_user` |
| `units_changed` |
| `value_changed` |

## Estimate Report

- Anchor: `estimate_report`
- Report code: `estimate_report`
- Maximum rows returned: 60 Thousand
- Data fields: 10
- Fixed fields: 0
- Filter fields: 9
- Date-like filters: None detected

### Data Fields

| Field | Label |
| --- | --- |
| `customer_name` | Customer Name |
| `estimated_on` | Estimated on |
| `estimator` | Estimator |
| `expires_on` | Expires on |
| `name` | Name |
| `number_of_scenarios` | Number of Scenarios |
| `quote_status` | Status |
| `reference` | Reference |
| `requested_on` | Requested on |
| `requestor` | Requestor |

### Filter Fields

| Field |
| --- |
| `customer_name` |
| `estimated_on` |
| `estimator` |
| `expires_on` |
| `name` |
| `quote_status` |
| `reference` |
| `requested_on` |
| `requestor` |

## Inbound Stock Transfer Report

- Anchor: `inbound_stock_transfer`
- Report code: `inbound_stock_transfer`
- Maximum rows returned: 60 Thousand
- Data fields: 32
- Fixed fields: 0
- Filter fields: 19
- Date-like filters: `created_at`, `expiry_date`, `transferred_at`

### Data Fields

| Field | Label |
| --- | --- |
| `base_quantity` | Base quantity |
| `base_unit_of_measure` | Base unit of measure |
| `case_quantity` | Case quantity |
| `cases_unit_of_measure` | Case unit of measure |
| `created_at` | Created date |
| `default_quantity` | Default quantity |
| `default_unit_of_measure` | Default unit of measure |
| `expiry_date` | Expiry date |
| `full_pallet_quantity` | Full Pallet quantity |
| `full_pallets_unit_of_measure` | Full Pallet unit of measure |
| `inbound_stock_transfer_order` | Inbound Stock Transfer Order |
| `inbound_stock_transfer_order_reference` | Inbound Stock Transfer Order reference |
| `inventory_category` | Inventory category |
| `inventory_status` | Inventory status |
| `is_finished_good` | Is Finished Good |
| `is_subcomponent` | Is Subcomponent |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_code` | Item code |
| `item_customer_name` | Item Customer name |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `location_name` | Location name |
| `lot_code` | Lot code |
| `pallet_number` | Pallet number |
| `site_name` | Site name |
| `transfer_status` | Transfer status |
| `transferred_at` | Transferred date |

### Filter Fields

| Field |
| --- |
| `created_at` |
| `expiry_date` |
| `inbound_stock_transfer_id` |
| `inbound_stock_transfer_order_id` |
| `is_finished_good` |
| `is_subcomponent` |
| `item_alternate_code_1` |
| `item_alternate_code_2` |
| `item_category_name` |
| `item_code` |
| `item_customer_name` |
| `item_family_name` |
| `item_gtin` |
| `item_type_name` |
| `item_upc` |
| `lot_code` |
| `pallet_number` |
| `transfer_status` |
| `transferred_at` |

## Inbound Stock Transfer Order Report

- Anchor: `inbound_stock_transfer_order`
- Report code: `inbound_stock_transfer_order`
- Maximum rows returned: 60 Thousand
- Data fields: 37
- Fixed fields: 0
- Filter fields: 22
- Date-like filters: `created_at`, `deliver_at`

### Data Fields

| Field | Label |
| --- | --- |
| `consumption_requirement` | Consumption required |
| `created_at` | Created date |
| `created_by` | Created by |
| `customer_name` | Customer name |
| `deliver_at` | Deliver by |
| `finished_good_code` | Finished Good code |
| `finished_good_description` | Finished Good description |
| `finished_good_production_quantity` | Finished Good production quantity |
| `finished_good_unit_of_measure` | Finished Good unit of measure |
| `inbound_stock_transfer_order_reference` | ISTO reference |
| `isto_status` | ISTO status |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class` | Item class |
| `item_code` | Item code |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type name |
| `item_upc` | Item UPC |
| `job_id` | Job ID |
| `location_name` | Location name |
| `notes` | Notes |
| `project_code` | Work Order code |
| `project_description` | Work Order description |
| `project_reference_1` | Work Order reference 1 |
| `project_reference_2` | Work Order reference 2 |
| `project_reference_3` | Work Order reference 3 |
| `project_reference_4` | Work Order reference 4 |
| `project_reference_5` | Work Order reference 5 |
| `project_status` | Work Order status |
| `site_name` | Site name |
| `unit_of_measure` | Unit of measure |
| `units_ordered` | Units ordered |
| `units_outstanding` | Units outstanding |
| `units_received` | Units received |

### Filter Fields

| Field |
| --- |
| `created_at` |
| `created_by` |
| `customer_name` |
| `deliver_at` |
| `finished_good_code` |
| `inbound_stock_transfer_order_id` |
| `isto_status` |
| `item_alternate_code_1` |
| `item_alternate_code_2` |
| `item_category_name` |
| `item_class` |
| `item_code` |
| `item_description` |
| `item_family_name` |
| `item_gtin` |
| `item_type_name` |
| `item_upc` |
| `job_id` |
| `location_name` |
| `notes` |
| `project_code` |
| `units_outstanding` |

## Inventory Adjustment Report

- Anchor: `inventory_adjustment`
- Report code: `inventory_adjustment`
- Maximum rows returned: 60 Thousand
- Data fields: 46
- Fixed fields: 0
- Filter fields: 36
- Date-like filters: `adjusted_expiry`, `adjustment_date`, `created_at`, `initial_expiry`, `initial_received_date`

### Data Fields

| Field | Label |
| --- | --- |
| `adjusted_cost_per_unit` | Adjusted Cost per Unit |
| `adjusted_customer` | Adjusted Customer |
| `adjusted_expiry` | Adjusted Expiry |
| `adjusted_inventory_category` | Adjusted Inventory Category |
| `adjusted_inventory_status` | Adjusted Inventory Status |
| `adjusted_item_category` | Adjusted Item Category |
| `adjusted_item_class` | Adjusted Item Class |
| `adjusted_item_code` | Adjusted Item code |
| `adjusted_item_default_uom` | Adjusted Item default UOM |
| `adjusted_item_description` | Adjusted Item description |
| `adjusted_item_family` | Adjusted Item Family |
| `adjusted_item_type` | Adjusted Item Type |
| `adjusted_location` | Adjusted Location |
| `adjusted_lot_code` | Adjusted Lot Code |
| `adjusted_pallet_number` | Adjusted Pallet Number |
| `adjusted_quantity` | Adjusted Quantity |
| `adjusted_vendor` | Adjusted Vendor |
| `adjustment_date` | Adjustment date |
| `cost_difference` | Cost difference |
| `created_at` | Created at |
| `id` | Adjustment ID |
| `initial_cost_per_unit` | Initial Cost per Unit |
| `initial_customer` | Initial Customer |
| `initial_expiry` | Initial Expiry |
| `initial_inventory_category` | Initial Inventory Category |
| `initial_inventory_status` | Initial Inventory Status |
| `initial_item_category` | Initial Item Category |
| `initial_item_class` | Initial Item Class |
| `initial_item_code` | Initial Item code |
| `initial_item_default_uom` | Initial Item default UOM |
| `initial_item_description` | Initial Item description |
| `initial_item_family` | Initial Item Family |
| `initial_item_type` | Initial Item Type |
| `initial_location` | Initial Location |
| `initial_lot_code` | Initial Lot Code |
| `initial_pallet_number` | Initial Pallet Number |
| `initial_produced_by_project` | Initial Produced by Work Order |
| `initial_quantity` | Initial Quantity |
| `initial_received_date` | Initial Received date |
| `initial_vendor` | Initial Vendor |
| `inventory_discrepancy_reason` | Adjustment reason |
| `inventory_discrepancy_reason_code` | Adjustment reason code |
| `quantity_difference` | Quantity difference |
| `reason` | Adjustment notes |
| `site` | Site |
| `user_login` | Created by (username) |

### Filter Fields

| Field |
| --- |
| `adjusted_customer` |
| `adjusted_expiry` |
| `adjusted_inventory_category` |
| `adjusted_inventory_status` |
| `adjusted_item_category` |
| `adjusted_item_class` |
| `adjusted_item_code` |
| `adjusted_item_family` |
| `adjusted_item_type` |
| `adjusted_location` |
| `adjusted_lot_code` |
| `adjusted_pallet_number` |
| `adjusted_quantity` |
| `adjusted_vendor` |
| `adjustment_date` |
| `cost_difference` |
| `created_at` |
| `initial_customer` |
| `initial_expiry` |
| `initial_inventory_category` |
| `initial_inventory_status` |
| `initial_item_category` |
| `initial_item_class` |
| `initial_item_code` |
| `initial_item_family` |
| `initial_item_type` |
| `initial_location` |
| `initial_lot_code` |
| `initial_pallet_number` |
| `initial_quantity` |
| `initial_received_date` |
| `initial_vendor` |
| `inventory_discrepancy_reason` |
| `inventory_discrepancy_reason_code` |
| `quantity_difference` |
| `user_login` |

## Inventory Snapshot Report

- Anchor: `inventory_snapshot`
- Report code: `inventory_snapshot`
- Maximum rows returned: 60 Thousand
- Data fields: 24
- Fixed fields: 1
- Filter fields: 13
- Date-like filters: `expiry_date`, `snapshot_at`

### Data Fields

| Field | Label |
| --- | --- |
| `base_quantity` | Base quantity |
| `base_unit_of_measure` | Base unit of measure |
| `case_quantity` | Case quantity |
| `case_unit_of_measure` | Case unit of measure |
| `customer_name` | Customer name |
| `default_quantity` | Default quantity |
| `default_unit_of_measure` | Default unit of measure |
| `expiry_date` | Expiry date |
| `full_pallet_quantity` | Full Pallet quantity |
| `full_pallet_unit_of_measure` | Full Pallet unit of measure |
| `inventory_category` | Inventory category |
| `inventory_status` | Inventory status |
| `is_finished_good` | Is Finished Good |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class` | Item class |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type` | Item type |
| `item_upc` | Item UPC |
| `lot_code` | Lot code |
| `pallet_number` | Pallet Number |

### Fixed Fields

| Field | Label |
| --- | --- |
| `item_code` | Item code |

### Filter Fields

| Field |
| --- |
| `customer_name` |
| `expiry_date` |
| `inventory_category` |
| `inventory_status` |
| `is_finished_good` |
| `item_category_name` |
| `item_class` |
| `item_code` |
| `item_family_name` |
| `item_type` |
| `lot_code` |
| `pallet_number` |
| `snapshot_at` |

## Invoice Report

- Anchor: `invoice`
- Report code: `invoice`
- Maximum rows returned: 60 Thousand
- Data fields: 38
- Fixed fields: 0
- Filter fields: 16
- Date-like filters: `invoiced_at`, `paid_at`

### Data Fields

| Field | Label |
| --- | --- |
| `alternate_code_1` | Item alternate code 1 |
| `alternate_code_2` | Item alternate code 2 |
| `bill_to` | Bill to |
| `charge_per_unit` | Charge per unit |
| `customer_code` | Customer code |
| `customer_name` | Customer name |
| `customer_notes` | Customer notes |
| `internal_notes` | Internal notes |
| `invoice_status` | Invoice status |
| `invoiced_at` | Invoice date |
| `item_category_name` | Item category name |
| `item_code` | Item code |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `job_id` | Job ID |
| `notes` | Invoice Item notes |
| `paid_at` | Paid date |
| `payment_due_on` | Payment due date |
| `po_line_item_number` | PO Line Item number |
| `project_code` | Work Order code |
| `project_id` | Work Order ID |
| `project_reference_1` | Work Order reference 1 |
| `project_reference_2` | Work Order reference 2 |
| `project_reference_3` | Work Order reference 3 |
| `project_reference_4` | Work Order reference 4 |
| `project_reference_5` | Work Order reference 5 |
| `purchase_order_number` | Purchase Order number |
| `reference_1` | Reference 1 |
| `reference_2` | Reference 2 |
| `shipment_id` | Shipment ID |
| `site_name` | Site name |
| `terms` | Terms |
| `total_charge` | Total charge |
| `unit_of_measure` | Unit of measure |
| `unit_quantity` | Unit quantity |

### Filter Fields

| Field |
| --- |
| `bill_to` |
| `customer_code` |
| `customer_name` |
| `invoice_status` |
| `invoiced_at` |
| `item_category_name` |
| `item_code` |
| `item_description` |
| `item_family_name` |
| `item_type_name` |
| `paid_at` |
| `payment_due_on` |
| `po_line_item_number` |
| `purchase_order_number` |
| `reference_1` |
| `reference_2` |

## Item Master Report

- Anchor: `item_master`
- Report code: `item_master`
- Maximum rows returned: 150 Thousand
- Data fields: 78
- Fixed fields: 0
- Filter fields: 11
- Date-like filters: `created_at`, `updated_at`

### Data Fields

| Field | Label |
| --- | --- |
| `account_name` | Account Name |
| `accounting_unit_of_measure` | Accounting Unit Of Measure |
| `alternate_code_1` | Alternate Code 1 |
| `alternate_code_2` | Alternate Code 2 |
| `auto_backflush` | Auto Backflush |
| `auto_quarantine_on_production` | Auto Quarantine On Production |
| `auto_quarantine_on_production_status_override` | Auto Quarantine On Production Status Override |
| `auto_quarantine_on_receipt` | Auto quarantine on receipt |
| `base_unit_of_measure` | Base Unit Of Measure |
| `case_unit_of_measure` | Case Unit Of Measure |
| `cases_per_pallet` | Cases Per Pallet |
| `code` | Code |
| `cost_per_unit` | Cost Per Unit |
| `country_of_origin` | Country Of Origin |
| `created_at` | Created At |
| `customer` | Customer |
| `customer_product_code` | Customer Product Code |
| `default_unit_of_measure` | Default Unit Of Measure |
| `description` | Description |
| `eaches_per_case` | Eaches Per Case |
| `expiry_date_format` | Expiry Date Format |
| `expiry_date_policy` | Expiry Date Policy |
| `expiry_date_rule` | Expiry Date Rule |
| `export_to_accounting` | Export To Accounting |
| `external_identifier` | External identifier |
| `freight_class` | Freight Class |
| `full_pallet_unit_of_measure` | Full Pallet Unit Of Measure |
| `gtin` | GTIN |
| `inactive` | Inactive |
| `include_in_jit_line_replenishment` | Include in JIT Line Replenishment |
| `include_in_lot_generation` | Include in lot code and expiry date generation |
| `include_in_material_ordering` | Include in Material Ordering |
| `include_in_picking` | Include In Picking |
| `is_finished_good` | Is Finished Good |
| `is_subcomponent` | Is Subcomponent |
| `item_category` | Item Category |
| `item_class` | Item class |
| `item_family` | Item Family |
| `item_type` | Item Type |
| `lead_time_days` | Lead Time Days |
| `lead_time_type` | Lead Time Type |
| `line_type_preference_primary` | Primary line type preference |
| `line_type_preference_secondary` | Secondary line type preference |
| `lot_code_policy` | Lot Code Policy |
| `lot_code_rule` | Lot Code Rule |
| `minimum_order_quantity` | Minimum order quantity |
| `nmfc_code` | NMFC Code |
| `order_increment` | Order increment |
| `performance` | Performance |
| `personnel` | Personnel |
| `pick_strategy` | Pick strategy |
| `pick_strategy_source` | Pick strategy source |
| `preferred_line_type` | Preferred line type |
| `production_rate_depends_on_number_of_people` | Production rate depends on number of people |
| `quick_consume` | Quick Consume |
| `receiving_unit_of_measure` | Receiving Unit Of Measure |
| `reconciliation_physical_difference_percentage_limit` | Reconciliation physical difference % limit |
| `reconciliation_unit_of_measure` | Reconciliation Unit Of Measure |
| `reject_rate` | Reject Rate |
| `reorder_strategy` | Reorder Strategy |
| `require_physical_count_during_reconciliation` | Require physical count during reconciliation |
| `safety_stock` | Safety Stock |
| `safety_stock_unit_of_measure` | Safety Stock Unit Of Measure |
| `service_category` | Service Category |
| `setup_time` | Setup time |
| `shelf_life_label` | Item Shelf Life |
| `standard_units_per_hour` | Standard Units Per Hour |
| `stop_ship_limit` | Stop ship limit |
| `teardown_time` | Teardown time |
| `track_lot_code_by` | Track Lot Code By |
| `track_pallets` | Track Pallets |
| `unit_purchase_price` | Unit purchase price |
| `upc` | UPC |
| `updated_at` | Updated At |
| `uuid` | UUID |
| `vendor` | Vendor |
| `weight_per_case` | Weight Per Case |
| `weight_per_pallet` | Weight Per Pallet |

### Filter Fields

| Field |
| --- |
| `account_id` |
| `created_at` |
| `customer` |
| `inactive` |
| `is_finished_good` |
| `is_subcomponent` |
| `item_category` |
| `item_family` |
| `item_type` |
| `updated_at` |
| `vendor` |

## Job Downtime Report

- Anchor: `job_downtime`
- Report code: `job_downtime`
- Maximum rows returned: 60 Thousand
- Data fields: 40
- Fixed fields: 0
- Filter fields: 21
- Date-like filters: `actual_job_end_at`, `actual_job_start_at`, `downtime_end_at`, `downtime_start_at`

### Data Fields

| Field | Label |
| --- | --- |
| `actual_job_end_at` | Actual Job end date |
| `actual_job_start_at` | Actual Job start date |
| `downtime_duration` | Downtime duration (min) |
| `downtime_end_at` | Downtime end |
| `downtime_notes` | Downtime notes |
| `downtime_reason_code` | Downtime reason code |
| `downtime_reason_description` | Downtime reason description |
| `downtime_reason_name` | Downtime reason name |
| `downtime_start_at` | Downtime start |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class_name` | Item class |
| `item_code` | Item code |
| `item_customer` | Item Customer |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `item_uuid` | Item UUID |
| `job_comments` | Job comments |
| `job_id` | Job ID |
| `job_reference` | Job reference |
| `line_lead_name` | Line lead name |
| `line_name` | Line name |
| `paid_downtime` | Paid downtime |
| `planned_downtime` | Planned downtime |
| `po_line_item_number` | PO Line Item number |
| `project_code` | Work Order code |
| `project_customer_name` | Work Order Customer |
| `project_id` | Work Order ID |
| `project_reference_1` | Work Order reference 1 |
| `project_reference_2` | Work Order reference 2 |
| `project_reference_3` | Work Order reference 3 |
| `project_reference_4` | Work Order reference 4 |
| `project_reference_5` | Work Order reference 5 |
| `purchase_order_number` | Purchase Order number |
| `scheduled_downtime` | Scheduled downtime |
| `site` | Site name |

### Filter Fields

| Field |
| --- |
| `actual_job_end_at` |
| `actual_job_start_at` |
| `downtime_end_at` |
| `downtime_reason_code` |
| `downtime_reason_name` |
| `downtime_start_at` |
| `item_category_name` |
| `item_class_name` |
| `item_code` |
| `item_customer` |
| `item_family_name` |
| `item_type_name` |
| `job_id` |
| `line_lead_name` |
| `line_name` |
| `paid_downtime` |
| `planned_downtime` |
| `po_line_item_number` |
| `project_code` |
| `purchase_order_number` |
| `scheduled_downtime` |

## Job Productivity Report

- Anchor: `job_productivity`
- Report code: `job_productivity`
- Maximum rows returned: 60 Thousand
- Data fields: 70
- Fixed fields: 0
- Filter fields: 25
- Date-like filters: `actual_job_end_at`, `actual_job_start_at`, `scheduled_start_at`

### Data Fields

| Field | Label |
| --- | --- |
| `actual_job_end_at` | Actual Job end date |
| `actual_job_start_at` | Actual Job start date |
| `actual_person_hours` | Actual person hours |
| `actual_person_hours_payable` | Actual person hours payable |
| `actual_person_hours_per_unit` | Actual person hours per unit |
| `actual_person_hours_productive` | Actual person hours productive |
| `actual_units_per_hour` | Actual units per hour |
| `actual_units_per_person_hour` | Actual units per person hour |
| `availability` | Availability |
| `duration` | Duration |
| `expected_person_hours_per_unit` | Expected person hours per unit |
| `expected_units_per_hour` | Expected units per hour |
| `expected_units_per_person_hour` | Expected units per person hour |
| `first_hour_availability` | Availability (first hour) |
| `first_hour_line_efficiency` | Efficiency (first hour) |
| `first_hour_performance` | Performance (first hour) |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class_name` | Item class name |
| `item_code` | Item code |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `item_uuid` | Item UUID |
| `job_comments` | Job comments |
| `job_status` | Job status |
| `job_uuid` | Job UUID |
| `line_efficiency` | Line Efficiency |
| `line_leader_name` | Line leader name |
| `line_name` | Line name |
| `machine_hours` | Machine hours |
| `machine_hours_per_unit` | Machine hours per unit |
| `machine_hours_productive` | Machine hours productive |
| `number_of_personnel` | Number of personnel |
| `number_of_time_reports` | Number of Time Records |
| `pallets_produced` | Pallets Produced |
| `percent_complete` | Percent complete |
| `performance` | Performance |
| `po_line_item_number` | PO Line Item number |
| `project_code` | Work Order code |
| `project_customer` | Work Order Customer |
| `project_description` | Work Order description |
| `project_id` | Work Order ID |
| `project_reference_1` | Work Order reference 1 |
| `project_reference_2` | Work Order reference 2 |
| `project_reference_3` | Work Order reference 3 |
| `project_reference_4` | Work Order reference 4 |
| `project_reference_5` | Work Order reference 5 |
| `purchase_order_number` | Purchase Order number |
| `reconciled_at` | Reconciliation completed at |
| `reconciliation_status` | Reconciliation status |
| `reference` | Job reference |
| `scheduled_end_at` | Scheduled end |
| `scheduled_start_at` | Scheduled start |
| `service_category_name` | Service Category |
| `signed_off` | Signed Off |
| `site_name` | Site name |
| `standard_people` | Standard people |
| `standard_performance` | Standard performance |
| `standard_person_hours` | Standard person hours |
| `standard_person_hours_per_unit` | Standard person hours per unit |
| `standard_units_per_hour` | Standard units per hour |
| `standard_units_per_person_hour` | Standard units per person hour |
| `unit_of_measure` | Unit of measure |
| `units_expected` | Units expected |
| `units_produced` | Units produced |
| `units_remaining` | Units remaining |

### Filter Fields

| Field |
| --- |
| `actual_job_end_at` |
| `actual_job_start_at` |
| `item_alternate_code_1` |
| `item_alternate_code_2` |
| `item_category_name` |
| `item_class_name` |
| `item_code` |
| `item_description` |
| `item_family_name` |
| `item_gtin` |
| `item_type_name` |
| `item_upc` |
| `job_status` |
| `line_leader_name` |
| `line_name` |
| `po_line_item_number` |
| `project_code` |
| `project_customer` |
| `purchase_order_number` |
| `reconciliation_status` |
| `reference` |
| `scheduled_start_at` |
| `service_category_name` |
| `signed_off` |
| `units_expected` |

## Job Profitability Report

- Anchor: `job_profitability`
- Report code: `job_profitability`
- Maximum rows returned: 60 Thousand
- Data fields: 108
- Fixed fields: 0
- Filter fields: 28
- Date-like filters: `actual_job_end_at`, `actual_job_start_at`, `invoiced_at`

### Data Fields

| Field | Label |
| --- | --- |
| `actual_cost_of_labor_and_materials` | Actual cost of labor and materials |
| `actual_cost_of_labor_and_materials_per_unit` | Actual cost of labor and materials per unit |
| `actual_gross_margin` | Actual gross margin |
| `actual_gross_profit` | Actual gross profit |
| `actual_job_end_at` | Actual Job end date |
| `actual_job_start_at` | Actual Job start date |
| `actual_labor_cost` | Actual Labor cost |
| `actual_labor_cost_per_person_hour` | Actual Labor cost per person hour |
| `actual_labor_cost_per_unit` | Actual Labor cost per unit |
| `actual_labor_margin` | Actual labor margin |
| `actual_labor_profit` | Actual labor profit |
| `actual_machine_cost` | Actual machine cost |
| `actual_machine_cost_per_unit` | Actual machine cost per unit |
| `actual_materials_cost` | Actual materials cost |
| `actual_materials_cost_per_unit` | Actual materials cost per unit |
| `actual_person_hours` | Actual person hours |
| `actual_person_hours_payable` | Actual person hours payable |
| `actual_person_hours_per_unit` | Actual person hours per unit |
| `actual_person_hours_productive` | Actual person hours productive |
| `actual_total_cost` | Actual total cost |
| `actual_total_cost_per_unit` | Actual total cost per unit |
| `actual_total_margin` | Actual total margin |
| `actual_total_profit` | Actual total profit |
| `actual_units_per_person_hour` | Actual units per person hour |
| `availability` | Availability |
| `customer_name` | Customer name |
| `duration` | Duration |
| `estimate_name` | Estimate name |
| `expected_cost_of_labor_and_materials` | Expected cost of labor and materials |
| `expected_cost_of_labor_and_materials_per_unit` | Expected cost of labor and materials per unit |
| `expected_gross_margin` | Expected gross margin |
| `expected_gross_profit` | Expected gross profit |
| `expected_labor_cost` | Expected Labor cost |
| `expected_labor_cost_per_unit` | Expected Labor cost per unit |
| `expected_labor_margin` | Expected Labor margin |
| `expected_labor_profit` | Expected Labor profit |
| `expected_materials_cost` | Expected materials cost |
| `expected_materials_cost_per_unit` | Expected materials cost per unit |
| `expected_total_charge` | Expected total charge |
| `expected_total_charge_per_unit` | Expected total charge per unit |
| `expected_total_cost` | Expected total cost |
| `expected_total_cost_per_unit` | Expected total cost per unit |
| `expected_total_margin` | Expected total margin |
| `expected_total_profit` | Expected total profit |
| `invoice_id` | Invoice ID |
| `invoiced` | Invoiced |
| `invoiced_at` | Invoice date |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class` | Item class |
| `item_code` | Item code |
| `item_customer` | Item Customer |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `item_uuid` | Item UUID |
| `job_comments` | Job comments |
| `job_reference` | Job reference |
| `job_status` | Job status |
| `job_uuid` | Job UUID |
| `labor_charge` | Labor charge |
| `labor_charge_per_person_hour` | Labor charge per person hour |
| `labor_charge_per_unit` | Labor charge per unit |
| `labor_percentage_of_charge` | Labor percentage of charge |
| `line_efficiency` | Line Efficiency |
| `line_leader_name` | Line leader name |
| `line_name` | Line name |
| `machine_hours` | Machine hours |
| `machine_hours_per_unit` | Machine Hours per unit |
| `machine_hours_productive` | Machine hours productive |
| `materials_charge` | Materials charge |
| `materials_charge_per_unit` | Materials charge per unit |
| `number_of_personnel` | Number of personnel |
| `number_of_time_reports` | Number of Time Records |
| `overhead_charge` | Overhead charge |
| `overhead_charge_per_unit` | Overhead charge per unit |
| `overhead_cost` | Overhead cost |
| `overhead_cost_per_unit` | Overhead cost per unit |
| `performance` | Performance |
| `po_line_item_number` | PO Line Item Number |
| `project_code` | Work Order Code |
| `project_description` | Work Order description |
| `project_id` | Work Order ID |
| `project_reference_1` | Work Order Reference 1 |
| `project_reference_2` | Work Order Reference 2 |
| `project_reference_3` | Work Order Reference 3 |
| `project_reference_4` | Work Order Reference 4 |
| `project_reference_5` | Work Order Reference 5 |
| `purchase_order_number` | Purchase Order number |
| `reconciled_at` | Reconciliation completed at |
| `reconciliation_status` | Reconciliation status |
| `scenario_name` | Scenario name |
| `service_category_name` | Service Category |
| `signed_off` | Signed Off |
| `site_name` | Site name |
| `standard_people` | Standard people |
| `standard_person_hours` | Standard person hours |
| `standard_person_hours_per_unit` | Standard Person Hours per unit |
| `standard_units_per_hour` | Standard units per hour |
| `total_charge` | Total charge |
| `total_charge_per_unit` | Total charge per unit |
| `unit_of_measure` | Unit of measure |
| `units_expected` | Units expected |
| `units_produced` | Units produced |
| `units_remaining` | Units remaining |

### Filter Fields

| Field |
| --- |
| `actual_job_end_at` |
| `actual_job_start_at` |
| `customer_name` |
| `estimate_name` |
| `invoiced` |
| `invoiced_at` |
| `item_alternate_code_1` |
| `item_alternate_code_2` |
| `item_category_name` |
| `item_code` |
| `item_description` |
| `item_family_name` |
| `item_gtin` |
| `item_type_name` |
| `item_upc` |
| `job_reference` |
| `job_status` |
| `line_leader_name` |
| `line_name` |
| `po_line_item_number` |
| `project_code` |
| `project_id` |
| `purchase_order_number` |
| `reconciliation_status` |
| `scenario_name` |
| `service_category_name` |
| `signed_off` |
| `units_expected` |

## Labor Report

- Anchor: `labor`
- Report code: `labor`
- Maximum rows returned: 60 Thousand
- Data fields: 34
- Fixed fields: 0
- Filter fields: 15
- Date-like filters: `clock_in_at`, `clock_out_at`

### Data Fields

| Field | Label |
| --- | --- |
| `availability` | Availability |
| `badge_code` | Badge |
| `badge_type_name` | Badge type name |
| `badge_type_prefix` | Badge type prefix |
| `badge_type_rate` | Badge type rate |
| `clock_in_at` | Clock in time |
| `clock_out_at` | Clock out time |
| `customer_name` | Item Customer name |
| `duration` | Duration |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_code` | Item code |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `job_id` | Job ID |
| `job_reference` | Job reference |
| `line_efficiency` | Line Efficiency |
| `line_leader_name` | Line leader name |
| `line_name` | Line name |
| `payable_hours` | Payable hours |
| `performance` | Performance |
| `productive_hours` | Productive hours |
| `project_code` | Work Order Code |
| `project_id` | Work Order ID |
| `reference_1` | Work Order reference 1 |
| `reference_2` | Work Order reference 2 |
| `reference_3` | Work Order reference 3 |
| `reference_4` | Work Order reference 4 |
| `reference_5` | Work Order reference 5 |
| `site_name` | Site name |

### Filter Fields

| Field |
| --- |
| `badge_code` |
| `badge_type_name` |
| `badge_type_prefix` |
| `badge_type_rate` |
| `clock_in_at` |
| `clock_out_at` |
| `customer_name` |
| `item_category_name` |
| `item_code` |
| `item_description` |
| `item_family_name` |
| `item_type_name` |
| `job_id` |
| `project_code` |
| `project_id` |

## Lot Code Audit Report

- Anchor: `lot_code_audit`
- Report code: `lot_code_audit`
- Maximum rows returned: 60 Thousand
- Data fields: 7
- Fixed fields: 0
- Filter fields: 7
- Date-like filters: `job_start_at`, `subcomponent_expiry_date`

### Data Fields

| Field | Label |
| --- | --- |
| `finished_good_code` | Finished Good code |
| `job_id` | Job |
| `job_start_at` | Job start date |
| `line_name` | Line name |
| `subcomponent_code` | Subcomponent code |
| `subcomponent_expiry_date` | Subcomponent expiry date |
| `subcomponent_lot_code` | Subcomponent lot code |

### Filter Fields

| Field |
| --- |
| `finished_good_code` |
| `job_id` |
| `job_start_at` |
| `line_name` |
| `subcomponent_code` |
| `subcomponent_expiry_date` |
| `subcomponent_lot_code` |

## Move Transaction Report

- Anchor: `move_transaction`
- Report code: `move_transaction`
- Maximum rows returned: 60 Thousand
- Data fields: 35
- Fixed fields: 0
- Filter fields: 20
- Date-like filters: `ended_at`, `expiry_date`, `requested_at`, `started_at`, `time_completed_at`

### Data Fields

| Field | Label |
| --- | --- |
| `assigned_to` | Assigned To |
| `base_quantity` | Base quantity |
| `base_unit_of_measure` | Base unit of measure |
| `case_quantity` | Case quantity |
| `cases_unit_of_measure` | Case unit of measure |
| `default_quantity` | Default quantity |
| `default_unit_of_measure` | Default unit of measure |
| `ended_at` | Ended at |
| `ended_by` | Ended by |
| `expiry_date` | Expiry date |
| `from_location` | From Location |
| `from_pallet_number` | From pallet number |
| `full_pallet_quantity` | Full Pallet quantity |
| `full_pallets_unit_of_measure` | Full pallet unit of measure |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class_name` | Item class |
| `item_code` | Item code |
| `item_customer_name` | Item Customer name |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `job_id` | Job ID |
| `lot_code` | Lot code |
| `move_notes` | Move notes |
| `requested_at` | Request Date |
| `site_name` | Site name |
| `started_at` | Started at |
| `started_by` | Started by |
| `time_completed_at` | Time completed |
| `to_location` | To Location |
| `to_pallet_number` | To pallet number |

### Filter Fields

| Field |
| --- |
| `assigned_to` |
| `ended_at` |
| `ended_by` |
| `expiry_date` |
| `from_location` |
| `from_pallet_number` |
| `item_category_name` |
| `item_class_name` |
| `item_code` |
| `item_customer_name` |
| `item_family_name` |
| `item_type_name` |
| `job_id` |
| `lot_code` |
| `requested_at` |
| `started_at` |
| `started_by` |
| `time_completed_at` |
| `to_location` |
| `to_pallet_number` |

## Outbound Stock Transfer Report

- Anchor: `outbound_stock_transfer`
- Report code: `outbound_stock_transfer`
- Maximum rows returned: 60 Thousand
- Data fields: 40
- Fixed fields: 0
- Filter fields: 22
- Date-like filters: `created_at`, `expiry_date`, `transferred_at`

### Data Fields

| Field | Label |
| --- | --- |
| `base_quantity` | Base quantity |
| `base_unit_of_measure` | Base unit of measure |
| `case_quantity` | Case quantity |
| `cases_unit_of_measure` | Case unit of measure |
| `created_at` | Created date |
| `default_quantity` | Default quantity |
| `default_unit_of_measure` | Default unit of measure |
| `expiry_date` | Expiry date |
| `from_location` | From Location |
| `full_pallet_quantity` | Full Pallet quantity |
| `full_pallets_unit_of_measure` | Full Pallet unit of measure |
| `inventory_category` | Inventory category |
| `inventory_status` | Inventory status |
| `is_finished_good` | Is Finished Good |
| `is_subcomponent` | Is Subcomponent |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_code` | Item code |
| `item_customer_name` | Item Customer name |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type name |
| `item_upc` | Item UPC |
| `job` | Job |
| `lot_code` | Lot code |
| `outbound_stock_transfer_reference_1` | Outbound Stock Transfer reference 1 |
| `outbound_stock_transfer_reference_2` | Outbound Stock Transfer reference 2 |
| `pallet_number` | Pallet number |
| `project_code` | Work Order code |
| `project_reference_1` | Work Order reference 1 |
| `project_reference_2` | Work Order reference 2 |
| `project_reference_3` | Work Order reference 3 |
| `project_reference_4` | Work Order reference 4 |
| `project_reference_5` | Work Order reference 5 |
| `project_status` | Work Order status |
| `site_name` | Site name |
| `transfer_status` | Transfer status |
| `transferred_at` | Transferred date |

### Filter Fields

| Field |
| --- |
| `created_at` |
| `expiry_date` |
| `is_finished_good` |
| `is_subcomponent` |
| `item_alternate_code_1` |
| `item_alternate_code_2` |
| `item_category_name` |
| `item_code` |
| `item_customer_name` |
| `item_family_name` |
| `item_gtin` |
| `item_type_name` |
| `item_upc` |
| `job` |
| `lot_code` |
| `outbound_stock_transfer_id` |
| `outbound_stock_transfer_reference_1` |
| `outbound_stock_transfer_reference_2` |
| `pallet_number` |
| `project_code` |
| `transfer_status` |
| `transferred_at` |

## Pallet Aging

- Anchor: `pallet_aging`
- Report code: `pallet_aging`
- Maximum rows returned: 60 Thousand
- Data fields: 36
- Fixed fields: 0
- Filter fields: 16
- Date-like filters: `stored_since`

### Data Fields

| Field | Label |
| --- | --- |
| `base_quantity` | Base quantity |
| `base_unit_of_measure` | Base unit of measure |
| `case_quantity` | Case Quantity |
| `cases_unit_of_measure` | Case Unit Of Measure |
| `customer_name` | Customer name |
| `default_quantity` | Default quantity |
| `default_unit_of_measure` | Default unit of measure |
| `expiry_date` | Expiry Date |
| `full_pallet_quantity` | Full Pallet Quantity |
| `full_pallets_unit_of_measure` | Full Pallet Unit Of Measure |
| `inventory_category` | Inventory category |
| `inventory_status` | Inventory status |
| `inventory_value` | Inventory value |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class` | Item class |
| `item_code` | Item code |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `item_weight_per_case` | Item weight per case |
| `item_weight_per_pallet` | Item weight per pallet |
| `location` | Location |
| `lot_code` | Lot Code |
| `material_cost_per_unit` | Material cost per unit |
| `pallet_number` | Pallet number |
| `site_name` | Site Name |
| `stored_since` | Stored since |
| `time_in_storage` | Time in storage |
| `time_in_storage_minutes` | Time in storage (minutes) |
| `time_in_storage_months` | Time in storage (months) |
| `time_in_storage_weeks` | Time in storage (weeks) |
| `warehouse_zone` | Zone |

### Filter Fields

| Field |
| --- |
| `customer_name` |
| `inventory_category` |
| `inventory_status` |
| `item_alternate_code_1` |
| `item_alternate_code_2` |
| `item_category_name` |
| `item_class` |
| `item_code` |
| `item_family_name` |
| `item_gtin` |
| `item_type_name` |
| `item_upc` |
| `location` |
| `pallet_number` |
| `stored_since` |
| `warehouse_zone` |

## Pallet Storage

- Anchor: `pallet_storage`
- Report code: `pallet_storage`
- Maximum rows returned: 250 Thousand
- Data fields: 11
- Fixed fields: 3
- Filter fields: 13
- Date-like filters: `stored_since`

### Data Fields

| Field | Label |
| --- | --- |
| `billed_since` | Billed since |
| `billed_time_in_storage_days` | Billed time in storage (days) |
| `billed_time_in_storage_minutes` | Billed time in storage (minutes) |
| `billed_time_in_storage_weeks` | Billed time in storage (weeks) |
| `billed_until` | Billed until |
| `customer_name` | Customer name |
| `item_category_name` | Item category name |
| `item_class_name` | Item class name |
| `item_description` | Item description |
| `item_type_name` | Item type |
| `stored_since` | Stored since |

### Fixed Fields

| Field | Label |
| --- | --- |
| `item_code` | Item code |
| `location_name` | Location name |
| `pallet_number` | Pallet number |

### Filter Fields

| Field |
| --- |
| `billed_time_in_storage_days` |
| `billed_time_in_storage_minutes` |
| `billed_time_in_storage_weeks` |
| `customer_name` |
| `item_category_name` |
| `item_class_name` |
| `item_code` |
| `item_type_name` |
| `location_name` |
| `pallet_number` |
| `storage_billing_period` |
| `stored_since` |
| `unbilled_storage_days` |

## Picked Inventory Report

- Anchor: `picked_inventory`
- Report code: `picked_inventory`
- Maximum rows returned: 60 Thousand
- Data fields: 33
- Fixed fields: 0
- Filter fields: 20
- Date-like filters: `date_picked_at`, `expiry_date`, `pick_started_at`

### Data Fields

| Field | Label |
| --- | --- |
| `date_picked_at` | Date picked |
| `drop_off_location` | Destination location |
| `expiry_date` | Expiry date |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class_name` | Item class |
| `item_code` | Picked Item code |
| `item_customer` | Item Customer |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type name |
| `item_upc` | Item UPC |
| `lot_code` | Lot code |
| `pallet_number` | Pallet number picked |
| `pick_started_at` | Pick started at |
| `pick_started_by` | Pick started by |
| `pick_up_location` | Pick up location |
| `picked_by` | Picked by |
| `project_code` | Work Order code |
| `project_id` | Work Order ID |
| `project_reference_1` | Work Order reference 1 |
| `project_reference_2` | Work Order reference 2 |
| `project_reference_3` | Work Order reference 3 |
| `project_reference_4` | Work Order reference 4 |
| `project_reference_5` | Work Order reference 5 |
| `ship_order_id` | Ship Order ID |
| `ship_order_reference_number` | Ship Order reference number |
| `site_name` | Site name |
| `status` | Pick List status |
| `unit_picks_unit_of_measure` | Unit of measure |
| `unit_quantity` | Quantity picked |

### Filter Fields

| Field |
| --- |
| `date_picked_at` |
| `drop_off_location` |
| `expiry_date` |
| `item_category_name` |
| `item_class_name` |
| `item_code` |
| `item_customer` |
| `item_family_name` |
| `item_type_name` |
| `lot_code` |
| `pallet_number` |
| `pick_list_id` |
| `pick_started_at` |
| `pick_started_by` |
| `pick_up_location` |
| `picked_by` |
| `project_code` |
| `project_id` |
| `ship_order_id` |
| `status` |

## Production Report

- Anchor: `production`
- Report code: `production`
- Maximum rows returned: 60 Thousand
- Data fields: 34
- Fixed fields: 0
- Filter fields: 20
- Date-like filters: `actual_job_end_at`, `actual_job_start_at`, `expiry_date`, `produced_at`

### Data Fields

| Field | Label |
| --- | --- |
| `actual_job_end_at` | Actual Job end date |
| `actual_job_start_at` | Actual Job start date |
| `customer_name` | Customer name |
| `expected_end_at` | Expected End Date |
| `expected_start_at` | Expected Start Date |
| `expiry_date` | Expiry date |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_code` | Item code |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `job_id` | Job |
| `line` | Line |
| `lot_code` | Lot code |
| `pallet_number` | Pallet Number |
| `po_line_item_number` | PO Line Item number |
| `produced_at` | Produced date |
| `project_code` | Work Order code |
| `project_id` | Work Order |
| `project_status` | Work Order status |
| `purchase_order_number` | Purchase Order number |
| `reference_1` | Reference 1 |
| `reference_2` | Reference 2 |
| `reference_3` | Reference 3 |
| `reference_4` | Reference 4 |
| `reference_5` | Reference 5 |
| `service_category_name` | Service Category |
| `site_name` | Site name |
| `unit_of_measure` | Unit of measure |
| `units_produced` | Units produced |

### Filter Fields

| Field |
| --- |
| `actual_job_end_at` |
| `actual_job_start_at` |
| `customer_name` |
| `expiry_date` |
| `item_alternate_code_1` |
| `item_alternate_code_2` |
| `item_category_name` |
| `item_code` |
| `item_family_name` |
| `item_gtin` |
| `item_type_name` |
| `item_upc` |
| `job_id` |
| `lot_code` |
| `po_line_item_number` |
| `produced_at` |
| `project_code` |
| `project_id` |
| `purchase_order_number` |
| `service_category_name` |

## Work Order Status Report

- Anchor: `project_status`
- Report code: `project_status`
- Maximum rows returned: 60 Thousand
- Data fields: 51
- Fixed fields: 0
- Filter fields: 35
- Date-like filters: `created_at`, `due_date_at`, `fixed_expiry_date`, `last_job_completed_at`, `planned_start_at`

### Data Fields

| Field | Label |
| --- | --- |
| `32521_custom_project_field_value_id` | Material Availability |
| `bom_version_name` | Bill of Materials Version |
| `created_at` | Created date |
| `custom_project_field_value` | Custom Work Order Field Value |
| `custom_work_order_field_label_1` | Custom work order field 1 (Material Availability) label |
| `custom_work_order_field_value_description_1` | Custom work order field 1 (Material Availability) value |
| `customer_name` | Customer name |
| `due_date_at` | Due date |
| `estimate_name` | Estimate name |
| `fixed_expiry_date` | Fixed Expiry Date |
| `fixed_lot_code` | Fixed Lot Code |
| `has_estimate` | Has Estimate |
| `has_uninvoiced_charge` | Has uninvoiced charge |
| `item_category_name` | Item category name |
| `item_class_name` | Item class |
| `item_code` | Item code |
| `item_customer` | Item Customer |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_type_name` | Item type |
| `last_job_completed_at` | Date last Job completed |
| `performance` | Performance |
| `planned_end_at` | Planned end |
| `planned_start_at` | Planned start |
| `po_line_item_number` | PO Line Item number |
| `priority` | Priority |
| `project_code` | Work Order Code |
| `project_description` | Work Order Description |
| `project_status` | Work Order Status |
| `purchase_order_number` | Purchase Order number |
| `reference_1` | Reference 1 |
| `reference_2` | Reference 2 |
| `reference_3` | Reference 3 |
| `reference_4` | Reference 4 |
| `reference_5` | Reference 5 |
| `scenario_name` | Scenario name |
| `short_close_notes` | Short Close Notes |
| `short_close_reason_code` | Short Close Reason Code |
| `short_close_reason_description` | Short Close Reason Description |
| `short_close_reason_name` | Short Close Reason Name |
| `site_name` | Site name |
| `standard_people` | Standard people |
| `standard_units_per_hour` | Standard units per hour |
| `total_charge` | Total charge |
| `uninvoiced_total_charge` | Uninvoiced total charge |
| `uninvoiced_total_charge_per_unit` | Uninvoiced total charge per unit |
| `uninvoiced_units_produced` | Uninvoiced units produced |
| `unit_of_measure` | Unit of measure |
| `units_expected` | Units expected |
| `units_produced` | Units Produced |
| `units_remaining` | Units remaining |

### Filter Fields

| Field |
| --- |
| `32521_custom_project_field_value_id` |
| `bom_version_name` |
| `created_at` |
| `custom_work_order_field_value_description_1` |
| `customer_name` |
| `due_date_at` |
| `fixed_expiry_date` |
| `fixed_lot_code` |
| `has_estimate` |
| `has_uninvoiced_charge` |
| `item_category_name` |
| `item_class_name` |
| `item_code` |
| `item_customer` |
| `item_description` |
| `item_family_name` |
| `item_type_name` |
| `last_job_completed_at` |
| `planned_start_at` |
| `po_line_item_number` |
| `priority` |
| `project_code` |
| `project_id` |
| `project_status` |
| `purchase_order_number` |
| `reference_1` |
| `reference_2` |
| `reference_3` |
| `reference_4` |
| `reference_5` |
| `short_close_notes` |
| `short_close_reason_code` |
| `short_close_reason_description` |
| `short_close_reason_name` |
| `units_expected` |

## Receipt Item Report

- Anchor: `receipt_item`
- Report code: `receipt_item`
- Maximum rows returned: 60 Thousand
- Data fields: 63
- Fixed fields: 0
- Filter fields: 29
- Date-like filters: `expiry_date`, `planned_receipt_expected_receive_at`, `received_at`

### Data Fields

| Field | Label |
| --- | --- |
| `added_at` | Added at |
| `added_by` | Added by |
| `base_quantity` | Base quantity |
| `base_unit_of_measure` | Base unit of measure |
| `bill_of_lading` | Bill of lading |
| `case_quantity` | Case quantity |
| `case_unit_of_measure` | Case unit of measure |
| `default_quantity` | Default quantity |
| `default_unit_of_measure` | Default unit of measure |
| `expiry_date` | Expiry date |
| `full_pallet_quantity` | Full Pallet quantity |
| `full_pallet_unit_of_measure` | Full Pallet unit of measure |
| `internal_notes` | Internal notes |
| `inventory_category` | Inventory category |
| `inventory_status` | Inventory status |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class` | Item class |
| `item_code` | Item code |
| `item_customer_name` | Item Customer name |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_shelf_life` | Shelf Life |
| `item_type_name` | Item type name |
| `item_upc` | Item UPC |
| `location_name` | Location name |
| `lot_code` | Lot code |
| `original_base_quantity` | Original base quantity |
| `original_base_unit_of_measure` | Original base unit of measure |
| `original_default_quantity` | Original default quantity |
| `original_default_unit_of_measure` | Original default unit of measure |
| `original_item_code` | Original item code |
| `packing_slip` | Packing slip |
| `pallet_number` | Pallet number |
| `planned_receipt_expected_receive_at` | Planned Receipt expected receive date |
| `planned_receipt_id` | Planned Receipt ID |
| `project_code` | Work Order code |
| `receipt_carrier_code` | Receipt Carrier code |
| `receipt_carrier_name` | Receipt Carrier name |
| `receipt_carrier_type` | Receipt Carrier type |
| `receipt_customer_name` | Receipt Customer name |
| `receipt_item_notes` | Receipt item notes |
| `receipt_reference_1` | Receipt reference 1 |
| `receipt_reference_2` | Receipt reference 2 |
| `receipt_status` | Receipt status |
| `receive_order` | Receive Order |
| `receive_order_carrier_name` | Receive Order Carrier name |
| `receive_order_code` | Receive Order code |
| `receive_order_customer_name` | Receive Order Customer name |
| `receive_order_expected_quantity` | Receive Order expected quantity |
| `receive_order_expected_unit_of_measure` | Receive Order expected unit of measure |
| `receive_order_item_expected_delivery_at` | Receive Order Item expected delivery date |
| `receive_order_received` | Receive Order received |
| `receive_order_reference` | Receive Order reference |
| `received_at` | Received at |
| `received_by` | Received by |
| `receiving_quantity` | Receiving quantity |
| `receiving_unit_of_measure` | Receiving unit of measure |
| `site_name` | Site name |
| `trailer_or_container` | Trailer or container |
| `vendor_name` | Vendor name |

### Filter Fields

| Field |
| --- |
| `bill_of_lading` |
| `expiry_date` |
| `inventory_category` |
| `inventory_status` |
| `item_alternate_code_1` |
| `item_alternate_code_2` |
| `item_category_name` |
| `item_class` |
| `item_code` |
| `item_customer_name` |
| `item_family_name` |
| `item_gtin` |
| `item_type_name` |
| `item_upc` |
| `lot_code` |
| `pallet_number` |
| `planned_receipt_expected_receive_at` |
| `planned_receipt_id` |
| `receipt_customer_name` |
| `receipt_reference_1` |
| `receipt_reference_2` |
| `receipt_status` |
| `receive_order` |
| `receive_order_code` |
| `receive_order_customer_name` |
| `receive_order_reference` |
| `received_at` |
| `trailer_or_container` |
| `vendor_name` |

## Receive Order Report

- Anchor: `receive_order`
- Report code: `receive_order`
- Maximum rows returned: 60 Thousand
- Data fields: 33
- Fixed fields: 1
- Filter fields: 22
- Date-like filters: `actual_ship_at`, `expected_delivery_at`, `expected_ship_at`, `ro_date_at`

### Data Fields

| Field | Label |
| --- | --- |
| `actual_ship_at` | Actual ship date |
| `actual_unit_quantity` | Actual unit quantity |
| `carrier_name` | Carrier name |
| `expected_delivery_at` | Expected delivery date |
| `expected_ship_at` | Expected ship date |
| `expected_unit_quantity` | Expected unit quantity |
| `internal_notes` | Internal notes |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class` | Item class |
| `item_code` | Item code |
| `item_customer` | Item Customer |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_material_cost_per_unit` | Item material cost per unit |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `number_of_receipts` | Number of Receipts |
| `project_code` | Work Order code |
| `purchase_price_per_unit` | Purchase price per unit |
| `purchaser` | Purchaser |
| `receive_order_code` | Receive Order code |
| `receive_order_customer` | Receive Order Customer |
| `received` | Received |
| `reference` | Reference |
| `ro_date_at` | RO Date |
| `site_name` | Site name |
| `status` | Status |
| `unit_of_measure` | Unit of measure |
| `vendor_name` | Vendor name |
| `vendor_notes` | Vendor notes |

### Fixed Fields

| Field | Label |
| --- | --- |
| `receive_order_id` | Receive Order |

### Filter Fields

| Field |
| --- |
| `actual_ship_at` |
| `expected_delivery_at` |
| `expected_ship_at` |
| `item_alternate_code_1` |
| `item_alternate_code_2` |
| `item_category_name` |
| `item_class` |
| `item_code` |
| `item_customer` |
| `item_family_name` |
| `item_gtin` |
| `item_type_name` |
| `item_upc` |
| `project_code` |
| `purchaser` |
| `receive_order_code` |
| `receive_order_customer` |
| `received` |
| `reference` |
| `ro_date_at` |
| `status` |
| `vendor_name` |

## Reconciliation Report

- Anchor: `reconciliation`
- Report code: `reconciliation`
- Maximum rows returned: 60 Thousand
- Data fields: 42
- Fixed fields: 2
- Filter fields: 18
- Date-like filters: `reconciled_date`

### Data Fields

| Field | Label |
| --- | --- |
| `adjusted_by_login` | Adjusted By |
| `consumed_quantity_value_in_recon_uom` | Item units consumed |
| `finished_good_code` | Finished Good code |
| `finished_good_description` | Finished Good description |
| `item_category_name` | Item Category name |
| `item_customer_name` | Item Customer name |
| `item_description` | Item description |
| `item_family_name` | Item Family name |
| `item_quantity_usage_variance_percentage` | % Item quantity usage variance |
| `item_reconciliation_threshold` | Item physical difference % limit |
| `item_type_name` | Item Type name |
| `item_vendor_name` | Item Vendor name |
| `item_yield_loss_percentage` | % Item yield loss |
| `item_yield_percentage` | % Item yield |
| `job_ids` | Job IDs |
| `line_leaders` | Line Leaders |
| `notes` | Notes |
| `pallets` | Pallets |
| `percentage_adjusted` | % Adjusted |
| `percentage_adjusted_exceeded_limit` | % Adjusted exceeded limit |
| `po_line_item_number` | PO Line Item number |
| `production_start` | Production start |
| `production_unit_of_measure` | Production Unit of Measure |
| `project_code` | Work Order code |
| `project_customer` | Work Order Customer name |
| `project_id` | Work Order ID |
| `project_reference_1` | Work Order Reference 1 |
| `project_reference_2` | Work Order Reference 2 |
| `project_reference_3` | Work Order Reference 3 |
| `project_reference_4` | Work Order Reference 4 |
| `project_reference_5` | Work Order Reference 5 |
| `purchase_order_number` | Purchase Order number |
| `quantity_produced_in_default_uom` | Finished Good units produced |
| `reason_code` | Reason code |
| `reason_description` | Reason |
| `reconciled_date` | Reconciled date |
| `reconciliation_unit_of_measure` | Reconciliation Unit of Measure |
| `rejected_quantity_value_in_recon_uom` | Item units rejected |
| `system_count_after_reconciliation` | System count after reconciliation |
| `system_count_before_reconciliation` | System count before reconciliation |
| `units_adjusted` | Item units adjusted |
| `usage_quantity_value_in_recon_uom` | Item usage |

### Fixed Fields

| Field | Label |
| --- | --- |
| `item_code` | Item code |
| `job_reconciliation_id` | Reconciliation ID |

### Filter Fields

| Field |
| --- |
| `finished_good_code` |
| `item_category_name` |
| `item_code` |
| `item_customer_name` |
| `item_family_name` |
| `item_quantity_usage_variance_percentage` |
| `item_type_name` |
| `item_vendor_name` |
| `item_yield_loss_percentage` |
| `item_yield_percentage` |
| `percentage_adjusted_exceeded_limit` |
| `po_line_item_number` |
| `project_code` |
| `project_id` |
| `purchase_order_number` |
| `reason_code` |
| `reason_description` |
| `reconciled_date` |

## Reject Report

- Anchor: `reject`
- Report code: `reject`
- Maximum rows returned: 60 Thousand
- Data fields: 43
- Fixed fields: 0
- Filter fields: 18
- Date-like filters: `actual_job_end_at`, `actual_job_start_at`, `expiry_date`, `rejected_at`

### Data Fields

| Field | Label |
| --- | --- |
| `actual_job_end_at` | Actual Job end date |
| `actual_job_start_at` | Actual Job start date |
| `base_quantity` | Base quantity |
| `base_unit_of_measure` | Base unit of measure |
| `case_quantity` | Case quantity |
| `cases_unit_of_measure` | Case unit of measure |
| `default_quantity` | Default quantity |
| `default_unit_of_measure` | Default unit of measure |
| `expiry_date` | Expiry date |
| `extended_cost` | Extended cost |
| `full_pallet_quantity` | Full Pallet quantity |
| `full_pallets_unit_of_measure` | Full Pallet unit of measure |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class` | Item class |
| `item_code` | Item code |
| `item_cost_per_unit` | Item cost per unit |
| `item_customer` | Item Customer |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `item_vendor` | Item Vendor |
| `job_id` | Job ID |
| `job_reference` | Job reference |
| `line_name` | Line name |
| `lot_code` | Lot code |
| `pallet_number` | Pallet number |
| `project_code` | Work Order Code |
| `project_customer` | Work Order Customer |
| `project_id` | Work Order ID |
| `project_reference_1` | Work Order reference 1 |
| `project_reference_2` | Work Order reference 2 |
| `project_reference_3` | Work Order reference 3 |
| `project_reference_4` | Work Order reference 4 |
| `project_reference_5` | Work Order reference 5 |
| `reject_code` | Reject code |
| `reject_reason` | Reject reason |
| `rejected_at` | Rejected at |
| `site_name` | Site name |
| `source_pallet` | Source Pallet |

### Filter Fields

| Field |
| --- |
| `actual_job_end_at` |
| `actual_job_start_at` |
| `expiry_date` |
| `item_category_name` |
| `item_code` |
| `item_customer` |
| `item_family_name` |
| `item_type_name` |
| `item_vendor` |
| `job_id` |
| `line_leader_name` |
| `line_name` |
| `lot_code` |
| `project_code` |
| `project_customer` |
| `project_id` |
| `reject_reason` |
| `rejected_at` |

## Reject Percentage Report

- Anchor: `reject_percentage`
- Report code: `reject_percentage`
- Maximum rows returned: 60 Thousand
- Data fields: 29
- Fixed fields: 0
- Filter fields: 12
- Date-like filters: `rejected_at`

### Data Fields

| Field | Label |
| --- | --- |
| `consumed_quantity` | Consumed quantity |
| `consumed_quantity_with_rejects` | Consumed quantity with rejects |
| `extended_cost` | Extended cost |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class` | Item class |
| `item_code` | Item code |
| `item_cost_per_unit` | Item cost per unit |
| `item_customer` | Item Customer |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `project_code` | Work Order code |
| `project_customer` | Work Order Customer |
| `project_id` | Work Order ID |
| `project_reference_1` | Work Order reference 1 |
| `project_reference_2` | Work Order reference 2 |
| `project_reference_3` | Work Order reference 3 |
| `project_reference_4` | Work Order reference 4 |
| `project_reference_5` | Work Order reference 5 |
| `reject_code` | Reject code |
| `reject_reason` | Reject reason |
| `rejected_percentage` | Rejected percentage |
| `rejected_quantity` | Rejected quantity |
| `site_name` | Site name |
| `unit_of_measure` | Unit of measure |

### Filter Fields

| Field |
| --- |
| `item_category_name` |
| `item_code` |
| `item_customer` |
| `item_family_name` |
| `item_type_name` |
| `line_leader_name` |
| `line_name` |
| `project_code` |
| `project_customer` |
| `project_id` |
| `reject_reason` |
| `rejected_at` |

## Scenario Report

- Anchor: `scenario_report`
- Report code: `scenario_report`
- Maximum rows returned: 60 Thousand
- Data fields: 63
- Fixed fields: 0
- Filter fields: 15
- Date-like filters: `created_at`, `effective_date_at`, `updated_at`

### Data Fields

| Field | Label |
| --- | --- |
| `created_at` | Created date |
| `customer_name` | Customer name |
| `effective_date_at` | Effective date |
| `estimate_id` | Estimate ID |
| `estimate_name` | Estimate name |
| `estimate_status` | Estimate status |
| `estimated_on` | Estimated date |
| `estimator` | Estimator |
| `expected_production` | Expected production |
| `expected_units_per_shift` | Expected units per shift |
| `expires_on` | Expires on |
| `item` | Item |
| `item_category_name` | Item category name |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_type_name` | Item type name |
| `labor_charge` | Labor charge |
| `labor_charge_per_unit` | Labor charge per unit |
| `labor_cost` | Labor cost |
| `labor_cost_per_unit` | Labor cost per unit |
| `labor_margin` | Labor margin |
| `labor_markup` | Labor markup |
| `labour_markup_per_unit` | Labor markup per unit |
| `labour_markup_percentage` | Labor markup % |
| `materials_charge` | Materials charge |
| `materials_charge_per_unit` | Materials charge per unit |
| `materials_cost` | Materials cost |
| `materials_cost_per_unit` | Materials cost per unit |
| `materials_margin` | Materials margin |
| `materials_markup` | Materials markup |
| `materials_markup_per_unit` | Materials markup per unit |
| `materials_markup_percentage` | Materials markup % |
| `overhead_charge` | Overhead charge |
| `overhead_charge_per_unit` | Overhead charge per unit |
| `overhead_cost` | Overhead cost |
| `overhead_cost_per_unit` | Overhead cost per unit |
| `overhead_margin` | Overhead margin |
| `overhead_markup` | Overhead markup |
| `overhead_markup_per_unit` | Overhead markup per unit |
| `overhead_markup_percentage` | Overhead markup % |
| `reference` | Reference |
| `requested_on` | Requested date |
| `requestor` | Requestor |
| `scenario_description` | Scenario description |
| `scenario_id` | Scenario ID |
| `scenario_loss_reason` | Scenario loss reason |
| `scenario_name` | Scenario name |
| `scenario_status` | Scenario status |
| `scenario_unit_of_measure` | Scenario unit of measure |
| `service_category_name` | Service Category |
| `standard_number_of_people` | Standard number of people |
| `standard_performance` | Standard performance |
| `standard_person_hours_per_unit` | Standard person hours per unit |
| `standard_person_minutes_per_unit` | Standard person minutes per unit |
| `standard_units_per_hour` | Standard units per hour |
| `standard_units_per_minute` | Standard units per minute |
| `standard_units_per_shift` | Standard units per shift |
| `total_charge` | Total charge |
| `total_charge_per_unit` | Total charge per unit |
| `total_cost` | Total cost |
| `total_cost_per_unit` | Total cost per unit |
| `updated_at` | Updated at date |
| `volume` | Volume |

### Filter Fields

| Field |
| --- |
| `created_at` |
| `customer_name` |
| `effective_date_at` |
| `estimated_on` |
| `expires_on` |
| `item` |
| `item_category_name` |
| `item_family_name` |
| `item_type_name` |
| `requested_on` |
| `scenario_loss_reason` |
| `scenario_name` |
| `scenario_status` |
| `service_category_name` |
| `updated_at` |

## Ship Order Report

- Anchor: `ship_order`
- Report code: `ship_order`
- Maximum rows returned: 60 Thousand
- Data fields: 34
- Fixed fields: 0
- Filter fields: 15
- Date-like filters: `expected_ship_at`, `ship_order_created_at`, `shipped_at`

### Data Fields

| Field | Label |
| --- | --- |
| `actual_unit_quantity` | Actual unit quantity |
| `added_unit_quantity` | Added unit quantity |
| `carrier` | Carrier |
| `carrier_code` | Carrier code |
| `carrier_type` | Carrier type |
| `detailed_purchase_order_number` | Detailed purchase order number |
| `expected_ship_at` | Expected ship date |
| `expected_unit_quantity` | Expected unit quantity |
| `full_pallet_quantity` | Full Pallet quantity |
| `full_pallet_weight` | Full pallet weight |
| `full_pallets_unit_of_measure` | Full Pallet unit of measure |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class` | Item class |
| `item_code` | Item code |
| `item_customer` | Item customer |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `number_of_shipments` | Number of Shipments |
| `ship_order_code` | Ship Order code |
| `ship_order_created_at` | Ship Order created at |
| `ship_order_customer` | Ship Order Customer |
| `ship_order_notes` | Ship Order notes |
| `ship_order_reference` | Ship Order reference |
| `ship_to` | Ship to |
| `ship_to_facility_number` | Ship to Facility Number |
| `shipped` | Shipped |
| `shipped_at` | Shipped At |
| `site_name` | Site name |
| `unit_of_measure` | Unit of measure |

### Filter Fields

| Field |
| --- |
| `detailed_purchase_order_number` |
| `expected_ship_at` |
| `item_category_name` |
| `item_class` |
| `item_code` |
| `item_customer` |
| `item_family_name` |
| `item_type_name` |
| `ship_order_code` |
| `ship_order_created_at` |
| `ship_order_customer` |
| `ship_order_reference` |
| `ship_to` |
| `shipped` |
| `shipped_at` |

## Shipment Item Report

- Anchor: `shipment_item`
- Report code: `shipment_item`
- Maximum rows returned: 60 Thousand
- Data fields: 71
- Fixed fields: 0
- Filter fields: 38
- Date-like filters: `actual_ship_at`, `created_at`, `ship_order_date_at`, `ship_order_expected_ship_at`, `shipment_expected_ship_at`

### Data Fields

| Field | Label |
| --- | --- |
| `actual_arrival_at` | Actual arrival date |
| `actual_delivery_at` | Actual delivery date |
| `actual_ship_at` | Actual ship date |
| `added_at` | Added at |
| `added_by` | Added by |
| `base_quantity` | Base quantity |
| `base_unit_of_measure` | Base unit of measure |
| `bill_of_lading_number` | Bill of Lading number |
| `bill_to` | Bill to |
| `carrier_code` | Carrier code |
| `carrier_name` | Carrier name |
| `carrier_type` | Carrier type |
| `case_quantity` | Case quantity |
| `case_ssccs` | Case SSCCs |
| `cases_unit_of_measure` | Case unit of measure |
| `created_at` | Created At |
| `default_quantity` | Default quantity |
| `default_unit_of_measure` | Default unit of measure |
| `dock_appointment_id` | Dock Appointment ID |
| `estimated_delivery_at` | Expected delivery date |
| `expected_arrival_at` | Expected arrival date |
| `expiry_date` | Expiry date |
| `freight_charge_amount` | Freight Charge amount |
| `freight_charge_terms` | Freight Charge terms |
| `full_pallet_quantity` | Full Pallet quantity |
| `full_pallets_unit_of_measure` | Full Pallet unit of measure |
| `internal_notes` | Internal notes |
| `inventory_category` | Inventory category |
| `inventory_status_name` | Inventory status |
| `invoice` | Invoice |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class` | Item class |
| `item_code` | Item code |
| `item_customer_name` | Item Customer name |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_material_cost_per_unit` | Item material cost per unit |
| `item_type_name` | Item type |
| `item_upc` | Item UPC |
| `lot_code` | Lot code |
| `master_bill_of_lading_number` | Master Bill of Lading number |
| `pallet_number` | Pallet number |
| `produced_by` | Produced by |
| `project_po_line_item_number` | Work Order PO Line Item number |
| `project_purchase_order_number` | Work Order Purchase Order number |
| `seal_number` | Seal number |
| `ship_from` | Ship from |
| `ship_order_carrier_name` | Ship Order Carrier name |
| `ship_order_code` | Ship Order code |
| `ship_order_customer_name` | Ship Order Customer name |
| `ship_order_date_at` | Ship Order date |
| `ship_order_expected_ship_at` | Ship Order expected ship date |
| `ship_order_id` | Ship Order ID |
| `ship_order_notes` | Ship Order notes |
| `ship_order_reference_number` | Ship Order reference number |
| `ship_order_ship_to_address` | Ship Order Ship to address |
| `ship_order_shipped` | Ship Order shipped status |
| `ship_to` | Ship to |
| `ship_to_facility_number` | Ship to Facility Number |
| `shipment_customer_code` | Shipment Customer code |
| `shipment_customer_name` | Shipment Customer name |
| `shipment_expected_ship_at` | Shipment expected ship date |
| `shipment_invoiced` | Shipment invoiced |
| `shipment_item_purchase_order_number` | Shipment Item purchase order number |
| `shipment_notes` | Shipment notes |
| `site_name` | Site name |
| `tracking_number` | Tracking or Pro number |
| `trailer_number` | Trailer |

### Filter Fields

| Field |
| --- |
| `actual_ship_at` |
| `bill_of_lading_number` |
| `bill_to` |
| `carrier_code` |
| `carrier_name` |
| `created_at` |
| `item_alternate_code_1` |
| `item_alternate_code_2` |
| `item_category_name` |
| `item_class` |
| `item_code` |
| `item_customer_name` |
| `item_family_name` |
| `item_gtin` |
| `item_type_name` |
| `item_upc` |
| `produced_by` |
| `project_po_line_item_number` |
| `project_purchase_order_number` |
| `seal_number` |
| `ship_order_carrier_name` |
| `ship_order_code` |
| `ship_order_customer_name` |
| `ship_order_date_at` |
| `ship_order_expected_ship_at` |
| `ship_order_id` |
| `ship_order_reference_number` |
| `ship_order_shipped` |
| `ship_to` |
| `ship_to_facility_number` |
| `shipment_customer_code` |
| `shipment_customer_name` |
| `shipment_expected_ship_at` |
| `shipment_id` |
| `shipment_invoiced` |
| `shipment_item_purchase_order_number` |
| `tracking_number` |
| `trailer_number` |

## UoM Ratios Report

- Anchor: `uom_ratios`
- Report code: `uom_ratios`
- Maximum rows returned: 125 Thousand
- Data fields: 5
- Fixed fields: 0
- Filter fields: 2
- Date-like filters: None detected

### Data Fields

| Field | Label |
| --- | --- |
| `active` | Active |
| `code` | Code |
| `conversion_unit_of_measure` | Conversion unit of measure |
| `ratio` | Ratio |
| `unit_of_measure` | Unit of measure |

### Filter Fields

| Field |
| --- |
| `account_id` |
| `reference_uom_ratio` |

## Weekly Consumption Report

- Anchor: `weekly_consumption`
- Report code: `weekly_consumption`
- Maximum rows returned: 60 Thousand
- Data fields: 29
- Fixed fields: 3
- Filter fields: 10
- Date-like filters: `consumed_at`, `consumed_date`, `expiry_date`

### Data Fields

| Field | Label |
| --- | --- |
| `actual_job_end_at` | Actual Job end date |
| `actual_job_start_at` | Actual Job start date |
| `consumed_at` | Consumed at |
| `consumed_date` | Consumed date |
| `expiry_date` | Expiry date |
| `finished_good_item_category_name` | Finished Good Item category name |
| `finished_good_item_code` | Finished Good Item code |
| `finished_good_item_customer` | Finished Good Item Customer |
| `finished_good_item_family_name` | Finished Good Item family name |
| `finished_good_item_type_name` | Finished Good Item type name |
| `job_id` | Job ID |
| `job_reconciliation_status` | Job reconciliation status |
| `job_reference` | Job reference |
| `line_name` | Line name |
| `lot_code` | Lot code |
| `po_line_item_number` | PO Line Item number |
| `project_code` | Work Order code |
| `project_customer` | Work Order Customer |
| `project_id` | Work Order ID |
| `project_reference_1` | Work Order reference 1 |
| `project_reference_2` | Work Order reference 2 |
| `project_reference_3` | Work Order reference 3 |
| `project_reference_4` | Work Order reference 4 |
| `project_reference_5` | Work Order reference 5 |
| `purchase_order_number` | Purchase Order number |
| `subcomponent_item_category_name` | Subcomponent Item Category name |
| `subcomponent_item_family_name` | Subcomponent Item family name |
| `subcomponent_item_type_name` | Subcomponent Item type name |
| `subcomponent_item_vendor` | Subcomponent Item Vendor |

### Fixed Fields

| Field | Label |
| --- | --- |
| `consumed_quantity` | Quantity consumed |
| `subcomponent_item_code` | Subcomponent Item code |
| `unit_of_measure_label` | Unit of measure |

### Filter Fields

| Field |
| --- |
| `consumed_at` |
| `consumed_date` |
| `expiry_date` |
| `job_id` |
| `lot_code` |
| `po_line_item_number` |
| `project_code` |
| `project_id` |
| `purchase_order_number` |
| `subcomponent_item_code` |

## Weekly Inventory Adjustment Summary Report

- Anchor: `weekly_inventory_adjustment_summary`
- Report code: `weekly_inventory_adjustment_summary`
- Maximum rows returned: 60 Thousand
- Data fields: 19
- Fixed fields: 0
- Filter fields: 9
- Date-like filters: `created_at`, `expiry_date`

### Data Fields

| Field | Label |
| --- | --- |
| `created_at` | Adjusted date |
| `expiry_date` | Expiry date |
| `inventory_discrepancy_reason` | Inventory adjustment reason |
| `inventory_discrepancy_reason_code` | Inventory adjustment reason code |
| `item_alternate_code_1` | Item alternate code 1 |
| `item_alternate_code_2` | Item alternate code 2 |
| `item_category_name` | Item category name |
| `item_class` | Item class |
| `item_code` | Item code |
| `item_customer_name` | Item Customer name |
| `item_description` | Item description |
| `item_family_name` | Item family name |
| `item_gtin` | Item GTIN |
| `item_type_name` | Item type name |
| `item_upc` | Item UPC |
| `lot_code` | Lot code |
| `site_name` | Site name |
| `unit_of_measure` | Unit of measure |
| `unit_quantity` | Unit quantity |

### Filter Fields

| Field |
| --- |
| `created_at` |
| `expiry_date` |
| `inventory_discrepancy_reason_code` |
| `item_category_name` |
| `item_code` |
| `item_customer_name` |
| `item_family_name` |
| `item_type_name` |
| `lot_code` |
