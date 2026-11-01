import {z} from 'zod';
export interface MailSenderIdentityStatus {
  state:'unconfigured'|'automatic'|'confirmed'|'needs-confirmation'|'invalidated'|'mismatch';
  bindingHash:string|null;fromAddress:string|null;accountDirectory:string|null;
  method:'automatic'|'user'|null;confirmedAt:string|null;receiptId:string|null;
  canConfirm:boolean;message:string;
}

export const mailSenderIdentityStatusSchema:z.ZodType<MailSenderIdentityStatus>=z.object({
 state:z.enum(['unconfigured','automatic','confirmed','needs-confirmation','invalidated','mismatch']),bindingHash:z.string().regex(/^[a-f0-9]{64}$/).nullable(),fromAddress:z.string().max(512).nullable(),accountDirectory:z.string().max(4096).nullable(),method:z.enum(['automatic','user']).nullable(),confirmedAt:z.iso.datetime().nullable(),receiptId:z.uuid().nullable(),canConfirm:z.boolean(),message:z.string().max(2048),
}).strict().superRefine((status,context)=>{
 if(['unconfigured','automatic','confirmed','mismatch'].includes(status.state)&&status.canConfirm)context.addIssue({code:'custom',message:'该状态不能提供确认入口'});
 if(['automatic','confirmed'].includes(status.state)&&(!status.bindingHash||!status.receiptId||!status.method||!status.confirmedAt))context.addIssue({code:'custom',message:'确认状态缺少持久回执'});
});
