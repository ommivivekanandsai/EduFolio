
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { Sparkles, Send, PlusCircle, Trash2, FileCheck, Image as ImageIcon, UploadCloud, Loader2 } from "lucide-react";
import Image from "next/image";
import { getStorage, ref, uploadString, getDownloadURL, uploadBytes } from "firebase/storage";
import { doc, setDoc } from "firebase/firestore";
import { app, db } from "@/lib/firebase";
import ConveyorLoader from "@/components/ui/ConveyorLoader";

import type { PortfolioData } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const storage = getStorage(app);

// Helper to convert data URI to Blob
function dataURItoBlob(dataURI: string) {
  const byteString = atob(dataURI.split(',')[1]);
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}


const FormSchema = z.object({
  studentName: z.string().min(3, "Please enter your full name.").max(50),
  profilePicture: z.string().min(1, "Please upload a profile picture."),
  personalDetails: z.string().min(10, "Please provide more details.").max(500),
  academicDetails: z.string().min(10, "Please provide more details.").max(500),
  projects: z.string().min(10, "Please describe at least one project.").max(1000),
  skills: z.string().min(2, "Please list your skills.").max(300),
  certificates: z.array(z.object({
    name: z.string().min(1, "File name is required."),
    file: z.string().min(1, "Please upload a certificate file."),
    description: z.string().min(3, "Please enter a short description.").max(200),
  })).optional(),
});

type FormValues = z.infer<typeof FormSchema>;

interface PortfolioFormProps {
  studentId: string;
  onPortfolioSaved: (data: PortfolioData) => void;
  initialData?: PortfolioData | null;
}

export default function PortfolioForm({ studentId, onPortfolioSaved, initialData = null }: PortfolioFormProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingCert, setIsUploadingCert] = useState<number | null>(null);
  const isEditing = !!initialData;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      studentName: initialData?.studentName || "",
      profilePicture: initialData?.profilePicture || "",
      personalDetails: initialData?.personalDetails || "",
      academicDetails: initialData?.academicDetails || "",
      projects: initialData?.projects || "",
      skills: initialData?.skills || "",
      certificates: initialData?.certificates || [],
    },
  });
  
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "certificates",
  });
  
  const handleProfilePicChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        const base64 = loadEvent.target?.result as string;
        form.setValue('profilePicture', base64, { shouldValidate: true });
        form.clearErrors('profilePicture');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCertFileChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsUploadingCert(index);
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        const base64 = loadEvent.target?.result as string;
        form.setValue(`certificates.${index}.file`, base64, { shouldValidate: true });
        form.setValue(`certificates.${index}.name`, file.name, { shouldValidate: true });
        form.clearErrors(`certificates.${index}.file`);
        setIsUploadingCert(null);
      };
      reader.readAsDataURL(file);
    }
  };

  async function uploadFile(fileDataUri: string, path: string): Promise<string> {
    const blob = dataURItoBlob(fileDataUri);
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, blob);
    return getDownloadURL(fileRef);
  }

  async function onSubmit(data: FormValues) {
    setIsLoading(true);
    toast({ title: "Submitting...", description: "Uploading files and saving your data. Please wait." });
    try {
      // 1. Upload profile picture if it's a data URI
      let profilePicUrl = data.profilePicture;
      if (data.profilePicture.startsWith('data:')) {
        profilePicUrl = await uploadFile(data.profilePicture, `portfolios/${studentId}/profile.jpg`);
      }
      
      // 2. Upload certificate files if they are data URIs
      const uploadedCertificates = await Promise.all(
        (data.certificates || []).map(async (cert, index) => {
          if (cert.file.startsWith('data:')) {
            const fileUrl = await uploadFile(cert.file, `portfolios/${studentId}/certs/${cert.name}`);
            return { ...cert, file: fileUrl };
          }
          return cert;
        })
      );

      // 3. Construct final portfolio data object
      const portfolioData: PortfolioData = {
        studentId,
        studentName: data.studentName,
        profilePicture: profilePicUrl,
        personalDetails: data.personalDetails,
        academicDetails: data.academicDetails,
        projects: data.projects,
        skills: data.skills,
        certificates: uploadedCertificates,
      };

      // 4. Save the final data to Firestore
      await setDoc(doc(db, "portfolios", studentId), portfolioData);
      
      // 5. Save to local storage for quick access, and call parent handler
      localStorage.setItem(`portfolio-${studentId}`, JSON.stringify(portfolioData));
      
      toast({
          title: `Portfolio ${isEditing ? 'Updated' : 'Saved'}!`,
          description: `Your portfolio has been successfully stored.`,
      });
      onPortfolioSaved(portfolioData);

    } catch (error) {
      console.error("Portfolio submission failed:", error);
      toast({
        variant: "destructive",
        title: "Submission Failed",
        description: "Could not save your portfolio. Please check your connection and try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  const profilePictureValue = form.watch("profilePicture");

  if (isLoading) {
    return (
        <div className="flex min-h-[50vh] w-full items-center justify-center">
            <ConveyorLoader />
        </div>
    );
  }

  return (
    <>
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-headline">{isEditing ? 'Edit Your Portfolio' : 'Create Your Portfolio'}</CardTitle>
          <CardDescription>{isEditing ? 'Update your details below.' : 'Fill in your details to dynamically generate your professional portfolio.'}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                <div className="md:col-span-1 flex flex-col items-center gap-2">
                    <FormLabel>Profile Picture</FormLabel>
                    <div className="relative w-32 h-32">
                        {profilePictureValue ? (
                            <Image src={profilePictureValue} alt="Profile Preview" layout="fill" className="rounded-full object-cover border-4 border-primary/20" />
                        ) : (
                            <div className="w-32 h-32 rounded-full bg-secondary flex items-center justify-center border-4 border-dashed border-primary/20">
                                <ImageIcon className="h-12 w-12 text-muted-foreground" />
                            </div>
                        )}
                    </div>
                     <FormField control={form.control} name="profilePicture" render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input type="file" onChange={handleProfilePicChange} accept="image/png, image/jpeg" className="text-xs w-full max-w-xs" />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                     )} />
                </div>
                <div className="md:col-span-2">
                     <FormField control={form.control} name="studentName" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter your full name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                </div>
            </div>

              <FormField control={form.control} name="personalDetails" render={({ field }) => (
                <FormItem>
                  <FormLabel>Personal Details</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Tell us about yourself, your goals, and interests..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="academicDetails" render={({ field }) => (
                <FormItem>
                  <FormLabel>Academic Details</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Your degree, university, relevant coursework, and academic achievements..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="projects" render={({ field }) => (
                <FormItem>
                  <FormLabel>Projects</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Describe your key projects, the technologies used, and your role..." {...field} rows={5} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="skills" render={({ field }) => (
                <FormItem>
                  <FormLabel>Skills</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., React, Node.js, Python, UI/UX Design..." {...field} />
                  </FormControl>
                  <FormDescription>Please provide a comma-separated list of your skills.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Certificates Section */}
              <div className="space-y-4">
                <FormLabel>Certificates</FormLabel>
                <FormDescription>Add any relevant certificates you have earned.</FormDescription>
                {fields.map((field, index) => (
                  <Card key={field.id} className="p-4 bg-secondary relative">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name={`certificates.${index}.file`}
                        render={({ field: { onChange, value, ...rest } }) => (
                          <FormItem>
                            <FormLabel>Certificate File</FormLabel>
                             <FormControl>
                                <Input 
                                  type="file" 
                                  onChange={(e) => handleCertFileChange(e, index)}
                                  accept="image/png, image/jpeg, application/pdf"
                                  className="pt-2 text-xs"
                                  disabled={isUploadingCert === index}
                                />
                              </FormControl>
                            {isUploadingCert === index && <div className="text-xs text-muted-foreground flex items-center gap-2 pt-2"><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</div>}
                            {form.watch(`certificates.${index}.file`) && isUploadingCert !== index && <div className="text-xs text-green-400 flex items-center gap-2 pt-2"><FileCheck className="h-4 w-4" /> {form.watch(`certificates.${index}.name`)}</div>}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`certificates.${index}.description`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Description</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g., Google Cloud Professional" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                     <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:bg-destructive/20 hover:text-destructive" onClick={() => remove(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Card>
                ))}
                <Button type="button" variant="outline" onClick={() => append({ name: '', file: '', description: '' })}>
                  <PlusCircle className="mr-2 h-4 w-4" /> Add Certificate
                </Button>
              </div>

              <Button type="submit" className="w-full text-lg">
                <UploadCloud className="mr-2 h-5 w-5" />
                {isEditing ? 'Update & Sync Portfolio' : 'Save & Publish Portfolio'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </>
  );
}
