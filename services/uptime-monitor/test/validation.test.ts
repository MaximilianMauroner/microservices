import { describe,expect,it } from "vitest";
import { monitorInput,monitorPatch } from "../src/worker/validation";

describe("API validation",()=>{it("accepts a monitor",()=>expect(monitorInput({name:" Site ",url:"https://EXAMPLE.com"})).toEqual({name:"Site",url:"https://example.com/"}));it.each([null,[],{}, {name:"",url:"https://example.com"},{name:"x",url:"file:///tmp/x"}])("rejects invalid create body",(value)=>expect(()=>monitorInput(value)).toThrow());it("accepts pause",()=>expect(monitorPatch({enabled:false})).toEqual({enabled:false}));it("rejects empty patch",()=>expect(()=>monitorPatch({})).toThrow("empty_patch"));});
