import { describe,expect,it } from "vitest";
import { chooseScheduleSlot } from "../src/worker/db";
import { mapConcurrent,MAX_MONITORING_SUBREQUESTS,MAX_TOTAL_SUBREQUESTS,scheduledSlot } from "../src/worker/scheduler";

describe("five-minute scheduler",()=>{
  it("maps each UTC minute to a stable slot",()=>expect([0,1,2,3,4,5,6,7,8,9].map((minute)=>scheduledSlot(new Date(Date.UTC(2026,0,1,0,minute))))).toEqual([0,1,2,3,4,0,1,2,3,4]));
  it("runs every item, limits concurrency to six, and survives failures",async()=>{let active=0;let peak=0;const seen:number[]=[];await mapConcurrent([0,1,2,3,4,5,6,7],6,async(value)=>{active+=1;peak=Math.max(peak,active);await Promise.resolve();seen.push(value);active-=1;if(value===2)throw new Error("expected");});expect(peak).toBe(6);expect(seen).toHaveLength(8);});
  it("balances 40 monitors with numeric tie-breaking and reuses freed capacity",()=>{const counts=new Map<number,number>();const slots:number[]=[];for(let index=0;index<40;index+=1){const slot=chooseScheduleSlot(counts);expect(slot).not.toBeNull();slots.push(slot!);counts.set(slot!,1+(counts.get(slot!)??0));}expect(slots.slice(0,5)).toEqual([0,1,2,3,4]);expect([...counts.values()]).toEqual([8,8,8,8,8]);expect(chooseScheduleSlot(counts)).toBeNull();counts.set(2,7);expect(chooseScheduleSlot(counts)).toBe(2);});
  it("keeps the documented free-tier budget",()=>{expect(MAX_MONITORING_SUBREQUESTS).toBe(8*6);expect(MAX_TOTAL_SUBREQUESTS).toBe(49);});
});
