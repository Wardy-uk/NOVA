<%@ Page MasterPageFile="~/MasterPage.master" Language="c#" Title="Product" EnableViewState="false" Inherits="Jwayela.BriefYourMarket.Public.LocalizedPage" %>
<%@ Import Namespace="System"%>
<%@ Import Namespace="System.Web"%>
<%@ Import Namespace="System.Collections.Generic"%>
<%@ Import Namespace="Jwayela.BriefYourMarket.Model"%>
<%@ Import Namespace="Jwayela.BriefYourMarket.Model.Products"%>
<%@ Import Namespace="System.Reflection"%>


<script runat="server" language="c#">
    private string m_productID;

    protected void Page_Init(object sender, EventArgs e)
    {
        m_productID = Request["id"];

        AddJsFile(string.Format("https://cdnjs.cloudflare.com/ajax/libs/jquery/3.5.1/jquery.min.js"));

        //Global Product Styles
        AddCssFile(string.Format("{0}Documents/CSS/Product.css", Settings.ExternalUrl));


        //Font Awesome Init
        AddCssFile(string.Format("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.14.0/css/all.min.css"));

        SetupPageDetails();
    }

    private void SetupPageDetails()
    {
        if (GetProduct != null)
        {
            SetupText();
            SetupImages();
            SetupButtons();
        }
    }

    private void SetupText()
    {

        Page.Title = GetProduct.Name;

        m_title.InnerText = GetProduct.Name;
        m_price.InnerText = "Asking Price: " + GetProduct.PriceText;
        m_description.InnerHtml = GetProduct.Description;
        m_bedrooms.InnerHtml = GetProduct.GetType().GetProperty("Bedrooms").GetValue(GetProduct, null).ToString() + " Bedrooms";
        m_bathrooms.InnerHtml = GetProduct.GetType().GetProperty("Bathrooms").GetValue(GetProduct, null).ToString() + " Bathrooms";
        m_livingRooms.InnerHtml = GetProduct.GetType().GetProperty("LivingRooms").GetValue(GetProduct, null).ToString() + " Living Areas";

        //foreach (var prop in GetProduct.GetType().GetProperties())
        //{
        //    m_bedrooms.InnerHtml = m_bedrooms.InnerHtml + " " + prop.Name;
        //}

    }

    private void SetupImages()
    {

        string RawUrl = Settings.GetApplicationKey().Split('.')[0];
        string BuiltUrl = "https://bymmedialive.azurewebsites.net/api/media/" + RawUrl + "/ProductImages/";

        List<string> images = new List<string>();

        if (GetProduct.Images != null)
        {
            const string imageHtml = "<img src=\\"{0}\\" class=\\"property-images__thumbnail swiper-slide\\">";

            foreach (ProductImage image in GetProduct.Images)
            {
                images.Add(string.Format(imageHtml, image.SourceUrl));
            }
        }

        m_images.InnerHtml = string.Join("", images.ToArray());
        m_activeImages.InnerHtml = string.Join("", images.ToArray());
    }

    private void SetupButtons()
    {
        List<string> buttons = new List<string>();
        const string buttonHtml2 = "<a href=\\"{0}\\" class=\\"btn btn--share btn--{1}\\"><i class=\\"fab fa-{1}\\"></i>{1}</a>";
        const string buttonHtml = "<a class=\\"{0}\\" href=\\"{1}\\" target=\\"_blank\\">{2}</a>";

        string share_external_link = HttpUtility.UrlEncode(string.Format("{0}Product.aspx?id={1}", Settings.ExternalUrl, m_productID));
        string share_on_facebook_link = string.Format("https://www.facebook.com/sharer/sharer.php?u={0}", share_external_link);
        string share_on_twitter_link = string.Format("https://twitter.com/home?status={0}", share_external_link);

        buttons.Add(string.Format(buttonHtml2, share_on_facebook_link, "facebook"));
        buttons.Add(string.Format(buttonHtml2, share_on_twitter_link, "twitter"));

        if (!string.IsNullOrEmpty(Settings.Products.ViewMoreProductsButtonLink))
        {
            buttons.Add(string.Format(buttonHtml, "link_button", Settings.Products.ViewMoreProductsButtonLink, "View more properties"));
        }

        m_linkButtons.InnerHtml = string.Join("", buttons.ToArray());
    }

    private ProductBase m_product;

    private ProductBase GetProduct
    {
        get { return m_product ?? (m_product = ProductBase.FindProductByAlternateId(m_productID)); }
    }
</script>

<asp:Content ID="Content1" ContentPlaceHolderID="MainContentHolder" runat="server">
    


   <main class="product-page">

       <section id="property-images">
            <div class="row row-md-column">
              <div class="col-xlg-9 col-md-12 col-no-padding property-images__main swiper-container">
                  <div class="swiper-wrapper" id="m_activeImages" runat="server"></div>
                  <div class="property-images__arrows">
                      <span class="property-images__arrow-prev"><i class="fa fa-chevron-left"></i></span>
                      <span class="property-images__arrow-next"><i class="fa fa-chevron-right"></i></span>
                  </div>
              </div>
              <div class="col-xlg-3 col-md-12 col-no-padding property-images__thumbnails swiper-container">
                <div class="swiper-wrapper" id="m_images" runat="server"></div>
              </div>
            </div>
          </section>

          <section id="property-details">
            <div class="container">
              <div class="row row-md-column">
                <div class="col-xlg-8 col-md-12 property-details__information">
                  <h1 class="property-details__name" id="m_title" runat="server"></h1>
                  <h5 class="property-details__price" id="m_price" runat="server"></h5>
                  <div class="property-details__features">
                    <div class="property-details__feature">
                      <i class="fa fa-bed property-details__feature-icon"></i>
                      <span class="property-details__feature-text" id="m_bedrooms" runat="server"></span>
                    </div>
                    <div class="property-details__feature">
                      <i class="fa fa-bath property-details__feature-icon"></i>
                      <span class="property-details__feature-text" id="m_bathrooms" runat="server"></span>
                    </div>
                    <div class="property-details__feature">
                      <i class="fa fa-couch property-details__feature-icon"></i>
                      <span class="property-details__feature-text" id="m_livingRooms" runat="server"></span>
                    </div>
                  </div>
                  <p class="property-details__description" id="m_description" runat="server"></p>
                </div>
                <div class="col-xlg-4 col-md-12 col-no-padding property-details__panel">
                  <div class="property-details__tile">
                    <h5 class="property-details__tile-title">Share online</h5>
                    <p class="property-details__tile-text">
                      Why not share this property with friends and family that are looking for a new home?
                    </p>
                    <div class="share-buttons" id="m_linkButtons" runat="server"></div>
                  </div>
                </div>
              </div>
            </div>
          </section>

        <!--Initiate Swiper JS-->
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/Swiper/5.4.5/css/swiper.css" />
        <script src="https://cdnjs.cloudflare.com/ajax/libs/Swiper/5.4.5/js/swiper.min.js"></script>

       <script>

           var galleryThumbs = new Swiper('.property-images__thumbnails', {
               spaceBetween: 10,
               freeMode: true,
               watchSlidesVisibility: true,
               watchSlidesProgress: true,
               slidesPerView: 3,
               breakpoints: {
                   1024: {
                       direction: 'vertical',
                   }
               }
           });
           
           var galleryTop = new Swiper('.property-images__main', {
               spaceBetween: 10,
               navigation: {
                   nextEl: '.property-images__arrow-next',
                   prevEl: '.property-images__arrow-prev'
               },
               thumbs: {
                   swiper: galleryThumbs
               }
           });

       </script>

   </main>

</asp:Content>