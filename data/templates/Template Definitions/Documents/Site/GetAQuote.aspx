
<%@ Page MasterPageFile="~/MasterPage.master" Language="c#" Title="Contact Us" EnableViewState="false" %>
<%@ Import Namespace="Jwayela.BriefYourMarket.Model.Postal" %>
<%@ Import Namespace="Jwayela.Data"%>
<%@ Import Namespace="System.Threading"%>
<%@ Import Namespace="Jwayela.BriefYourMarket.Model"%>
<%@ Import Namespace="Jwayela.BriefYourMarket.Model.Helpers"%>
<%@ Import Namespace="Jwayela.BriefYourMarket.Model.Data"%>
<%@ Import Namespace="Jwayela.BriefYourMarket.Model.MetaData"%>
<script runat="server" language="c#">
    private string GetSetting(string name)
    {
        LookupValue brandValue = BrandValue.GetCurrentBrand(true);
        string settingValue = string.Format("Setting [{0}] not found!", name);
        try
        {
            if (brandValue != null && brandValue.Value != null)
            {
                settingValue = brandValue.GetSettingValue(name);
            }
            else
            {
                Brand brand = new Brand();
                LookupValueSpecificSettingDefault setting = brand.PropertyType.GetSetting(name);
                settingValue = setting != null ? setting.DefaultValue : GetGlobalSetting(name);
            }
        }
        catch (Exception e)
        {
            // ignore
        }

        return settingValue;
    }

    private static string GetGlobalSetting(string name)
    {
        string settingValue;
        string value = Settings.SettingsProvider.GetSettingValue(name);
        settingValue = !string.IsNullOrEmpty(value) ? value : "";
        return settingValue;
    }


    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);


        if (!IsPostBack)
        {

            PostalContact contact = PostalContact.GetLoggedInContact() as PostalContact;

            if (contact != null)
            {


                Log.Logger.InfoFormat("Found Contact {0}", contact.EMail);
                m_firstName.Text = contact.FirstName;
                m_lastName.Text = contact.LastName;
                m_telephone.Text = contact.Mobile;
                m_email.Text = contact.EMail;



            }
            else
            {
                Log.Logger.InfoFormat("No Contact Found");
            }
        }
    }

    protected void OnSend(object sender, EventArgs e)
    {

        if (Page.IsValid)
        {

            IList<PostalContact> contacts = Repository.FindByEmailAddress(m_email.Text).Cast<PostalContact>().ToList();

            if (contacts.Count == 0)
            {
                contacts.Add((PostalContact)ContactBase.CreateNew());
            }

            foreach (PostalContact contact in contacts)
                    {
                        contact.EMail = m_email.Text;
                        contact.FirstName = m_firstName.Text;
                        contact.LastName = m_lastName.Text;
                        contact.Mobile = m_telephone.Text;
                        contact.Source = "Quote Request";

                        if (contact.IsValid(new List<string>()))
                        {
                            //contact.SaveWithConfirmation();
                            DataAccess.Save(contact);
                        }
                        else
                        {
                            Log.Logger.Debug("Could not save contact - validation failed.");
                        }

                        IndividualMessage newContactUsMessage = new IndividualMessage();

                newContactUsMessage.Template = Template.Get("Call To Action");

                string Subject = "";
                try
                {
                    Subject = Interaction.Get(int.Parse((new HttpHelper()).GetCookie("InitialInteraction").Value)).Subject;
                }
                catch
                {
                    Subject = "No Subject Found.";
                }

                newContactUsMessage.HtmlBody = string.Format(@"<p>The person below wishes to be contacted about a quote.</p>
            <p>Subject: {0}</p>
            <p>First Name: {1}</p>
            <p>Last Name : {2}</p>
            <p>Email: {3}</p>
            <p>Mobile Number: {4}</p>
            ", Subject, contact.FirstName, contact.LastName, contact.EMail, contact.Mobile);

                newContactUsMessage.TextBody = string.Format(@"The person below wishes to be contacted about a quote
            Subject: {0}
            First Name: {1}
            Last Name : {2}
            Email: {3}
            Mobile Number: {4}
            ", Subject, contact.FirstName, contact.LastName, contact.EMail, contact.Mobile);

                Log.Logger.Debug("Sending Expression of Contact.");

                if (newContactUsMessage.Template != null && newContactUsMessage.Template.Id > 0)
                {
                    newContactUsMessage.Template = Repository.Get<Template>(newContactUsMessage.Template.Id); // Might be getting template from the session and not reattaching, hack basically
                }

                newContactUsMessage.Title = "Contact this person";

                IList<LookupValue> lists = PropertyType.GetPropertyType(typeof(ContactLists)).GetLookupValues();
                foreach (LookupValue contactList in lists)
                {
                    if (contactList.ToString().EndsWith("Quote Call To Action Recipients"))
                    {
                        newContactUsMessage.SendToList = contactList;
                        break;
                    }
                }

                Log.Logger.Info(newContactUsMessage.HtmlBody);

                if (newContactUsMessage.SendToList != null)
                {
                    DataAccess.Save(newContactUsMessage);
                    newContactUsMessage.Send(DateTime.Now, null);
                }
                else
                {
                    Log.Logger.Error("Failed to Send Message");

                }

                
            }

            Response.Redirect("QuoteRequestComplete.aspx");

                        
                    }
        else
            {
                Log.Logger.InfoFormat("No Contact Found");
                Response.Redirect("QuoteRequestFailed.aspx");
            }


    }

    protected void OnCancel(object sender, EventArgs e)
    {
        Response.Redirect("~/");
    }


</script>

<asp:Content ID="Content1" ContentPlaceHolderID="MainContentHolder" runat="server">

    <style type="text/css">

         .formRow label  {
            display: inline-block;
            width: 80px;
        }

    </style>

    <div id="contentContainer">
        <h4 style="padding-top: 20px;">
            Thank you for requesting a Quote, to confirm, please check your details and click the submit button below.</h4>

        <p class="formRow">
	        <label for="">First name</label>
	        <asp:TextBox runat='server' ID="m_firstName" />
        </p>
         <p class="formRow">
		    <label for="">Last name</label>
		    <asp:TextBox runat='server' ID="m_lastName" />
	    </p> 
        <p class="formRow">
	        <label for="">Email</label>
	        <asp:TextBox runat='server' ID="m_email" />
        </p>                 
        <p class="formRow">
	        <label for="">Telephone</label>
	        <asp:TextBox runat='server' ID="m_telephone" />
        </p> 
        <div class="formColLeft"><p>&nbsp;</p></div>
        <div class="formColRight">
			<p>
                <asp:LinkButton ID="LinkButton1" style="background-color:#ffffff; font-size:16px; padding:10px; color:#333333" CssClass="submit-form button buttonUser blue" runat="server" 
                    onclick="OnSend">Submit</asp:LinkButton>
            </p>
		</div>

    </div>
</asp:Content>
