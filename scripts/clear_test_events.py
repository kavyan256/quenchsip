#!/usr/bin/env python3
"""Lists (and with --yes deletes) test events in the deployed table, e.g. before recording the demo.

Usage:
  python3 scripts/clear_test_events.py                 # list events whose name is in TEST_NAMES
  python3 scripts/clear_test_events.py --name "X"      # list events named X (repeatable)
  python3 scripts/clear_test_events.py --yes           # delete what is listed

Uses the AWS CLI (profile/region below, or AWS_PROFILE / AWS_REGION), so it works behind a proxy.
"""
import json
import os
import subprocess
import sys

PROFILE = os.environ.get("AWS_PROFILE", "quenchsip")
REGION = os.environ.get("AWS_REGION", "ap-south-1")
STACK = os.environ.get("STACK", "quench")

# Names the automated tests create.
TEST_NAMES = {
    "Test Fest", "Tap Fest", "Projector Fest", "Dispatch Fest", "Summary Fest", "Queue Fest",
    "Board Test", "Stock Test", "Dispatch Test", "Reassign Test", "Load Test", "Dbg", "Spring Fest",
}


def aws(*args, payload=None):
    cmd = ["aws", *args, "--profile", PROFILE, "--region", REGION, "--output", "json"]
    if payload is not None:
        cmd += ["--cli-input-json", json.dumps(payload)]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
    return json.loads(out) if out.strip() else {}


def table_name():
    outputs = aws("cloudformation", "describe-stacks", "--stack-name", STACK)["Stacks"][0]["Outputs"]
    return next(o["OutputValue"] for o in outputs if o["OutputKey"] == "TableName")


def scan_all(table, **kw):
    items, start = [], None
    while True:
        payload = {"TableName": table, **kw}
        if start:
            payload["ExclusiveStartKey"] = start
        res = aws("dynamodb", "scan", payload=payload)
        items += res.get("Items", [])
        start = res.get("LastEvaluatedKey")
        if not start:
            return items


def main():
    args = sys.argv[1:]
    names = set()
    while "--name" in args:
        i = args.index("--name")
        names.add(args[i + 1])
        del args[i : i + 2]
    names = names or TEST_NAMES
    really = "--yes" in args

    table = table_name()
    metas = scan_all(
        table,
        FilterExpression="SK = :m",
        ExpressionAttributeValues={":m": {"S": "META"}},
        ProjectionExpression="PK, #n, createdAt",
        ExpressionAttributeNames={"#n": "name"},
    )
    targets = [m for m in metas if m.get("name", {}).get("S") in names]
    for m in sorted(targets, key=lambda x: x.get("createdAt", {}).get("S", "")):
        print(f'{m["PK"]["S"][4:]}  {m.get("createdAt", {}).get("S", "?")}  {m["name"]["S"]}')
    print(f"{len(targets)} event(s) match.")
    if not really:
        print("Nothing deleted. Run again with --yes to delete these events and everything in them.")
        return

    ids = {m["PK"]["S"][4:] for m in targets}
    keys = []
    for eid in ids:
        start = None
        while True:
            payload = {
                "TableName": table,
                "KeyConditionExpression": "PK = :pk",
                "ExpressionAttributeValues": {":pk": {"S": f"EVT#{eid}"}},
                "ProjectionExpression": "PK, SK",
            }
            if start:
                payload["ExclusiveStartKey"] = start
            res = aws("dynamodb", "query", payload=payload)
            keys += [{"PK": i["PK"], "SK": i["SK"]} for i in res.get("Items", [])]
            start = res.get("LastEvaluatedKey")
            if not start:
                break
    # Entries in the live-event index point at these events too.
    index = scan_all(table, FilterExpression="PK = :e", ExpressionAttributeValues={":e": {"S": "EVENTS"}}, ProjectionExpression="PK, SK, id")
    keys += [{"PK": i["PK"], "SK": i["SK"]} for i in index if i.get("id", {}).get("S") in ids]

    for k in range(0, len(keys), 25):
        batch = [{"DeleteRequest": {"Key": key}} for key in keys[k : k + 25]]
        res = aws("dynamodb", "batch-write-item", payload={"RequestItems": {table: batch}})
        if res.get("UnprocessedItems"):
            print("Some items were not deleted; run the script again.", file=sys.stderr)
    print(f"Deleted {len(ids)} event(s), {len(keys)} item(s).")


if __name__ == "__main__":
    main()
